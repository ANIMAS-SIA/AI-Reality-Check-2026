import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { hashToken } from "../_shared/tokens.ts";

type CheckinPayload = {
  token?: string;
  deviceLabel?: string;
};

type TokenRow = {
  participant_id: string;
  purpose: string;
  expires_at: string | null;
  revoked_at: string | null;
  used_at: string | null;
};

type ParticipantRow = {
  id: string;
  event_id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: string | null;
  status: string;
  access_mode: string;
};

type CompanyRow = {
  id: string;
  name: string;
  c360_registration_number: string | null;
};

type CheckinRow = {
  id: string;
  participant_id: string;
  scan_result: string;
  scanned_at: string;
};

function requireAdmin(request: Request): Response | null {
  const expected = Deno.env.get("ADMIN_API_KEY");
  if (!expected) return errorResponse("ADMIN_API_KEY is not configured", 500);
  const actual = request.headers.get("x-admin-key") || "";
  if (actual !== expected) return errorResponse("Unauthorized", 401);
  return null;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    application_received: "Pieteikums saņemts",
    approved: "Dalība apstiprināta",
    waitlisted: "Gaidīšanas saraksts",
    rejected: "Dalība atteikta",
    cancelled: "Dalībnieks atteicies",
    reconfirm_required: "Ierašanās atkārtoti jāapstiprina",
    arrived: "Dalībnieks ieradies",
    no_show: "Dalībnieks nav ieradies",
  };
  return labels[status] || status;
}

async function participantPayload(db: SupabaseRest, participant: ParticipantRow, duplicate = false) {
  let company: CompanyRow | null = null;
  if (participant.company_id) {
    company = (await db.select<CompanyRow>("companies", {
      id: `eq.${participant.company_id}`,
      limit: 1,
    }))[0] || null;
  }

  return {
    id: participant.id,
    name: `${participant.first_name} ${participant.last_name}`.trim(),
    email: participant.email,
    role: participant.role || "",
    status: participant.status,
    status_label: statusLabel(participant.status),
    access_mode: participant.access_mode,
    company_name: company?.name || "Nepārstāv uzņēmumu",
    company,
    duplicate,
  };
}

async function resolveParticipant(db: SupabaseRest, token: string) {
  const tokenHash = await hashToken(token, requiredEnv("TOKEN_PEPPER"));
  let rows = await db.select<TokenRow>("participant_tokens", {
    token_hash: `eq.${tokenHash}`,
    purpose: "eq.qr_checkin",
    revoked_at: "is.null",
    limit: 1,
  });
  if (!rows[0]) {
    rows = await db.select<TokenRow>("participant_tokens", {
      token_hash: `eq.${tokenHash}`,
      purpose: "eq.magic_link",
      revoked_at: "is.null",
      limit: 1,
    });
  }
  const tokenRow = rows[0];
  if (!tokenRow) return { error: errorResponse("QR token is invalid", 404) };
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
    return { error: errorResponse("QR token has expired", 410) };
  }

  const participants = await db.select<ParticipantRow>("participants", {
    id: `eq.${tokenRow.participant_id}`,
    limit: 1,
  });
  const participant = participants[0];
  if (!participant) return { error: errorResponse("Participant not found", 404) };
  return { tokenHash, tokenRow, participant };
}

async function previewCheckin(db: SupabaseRest, token: string): Promise<Response> {
  const resolved = await resolveParticipant(db, token);
  if (resolved.error) return resolved.error;
  const participant = resolved.participant!;
  const duplicate = participant.status === "arrived" || Boolean(resolved.tokenRow!.used_at);
  return jsonResponse({ participant: await participantPayload(db, participant, duplicate) });
}

async function confirmCheckin(db: SupabaseRest, payload: CheckinPayload): Promise<Response> {
  const token = (payload.token || "").trim();
  if (!token) return errorResponse("Token is required", 400);

  const resolved = await resolveParticipant(db, token);
  if (resolved.error) return resolved.error;
  const participant = resolved.participant!;
  const duplicate = participant.status === "arrived" || Boolean(resolved.tokenRow!.used_at);
  const invalidStatus = !["approved", "reconfirm_required", "arrived"].includes(participant.status);
  const scanResult = duplicate ? "duplicate" : invalidStatus ? "invalid_status" : "accepted";

  const checkins = await db.insert<CheckinRow>("checkins", [{
    event_id: participant.event_id,
    participant_id: participant.id,
    scan_result: scanResult,
    device_label: payload.deviceLabel || null,
    metadata: {
      previous_status: participant.status,
    },
  }]);

  if (scanResult === "accepted") {
    await db.update("participants", { status: "arrived" }, { id: `eq.${participant.id}` });
    if (resolved.tokenRow!.purpose === "qr_checkin") {
      await db.update("participant_tokens", { used_at: new Date().toISOString() }, {
        token_hash: `eq.${resolved.tokenHash}`,
        purpose: "eq.qr_checkin",
      });
    }
  }

  const latestParticipant = scanResult === "accepted"
    ? { ...participant, status: "arrived" }
    : participant;

  return jsonResponse({
    checkin: checkins[0],
    result: scanResult,
    participant: await participantPayload(db, latestParticipant, duplicate),
  });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const adminError = requireAdmin(request);
  if (adminError) return adminError;

  try {
    const db = new SupabaseRest();

    if (request.method === "GET") {
      const token = (new URL(request.url).searchParams.get("token") || "").trim();
      if (!token) return errorResponse("Token is required", 400);
      return await previewCheckin(db, token);
    }

    if (request.method === "POST") {
      return await confirmCheckin(db, await readJson<CheckinPayload>(request));
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Check-in failed", 500, String(error));
  }
});
