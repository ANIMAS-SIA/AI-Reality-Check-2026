import { errorResponse, handleOptions, jsonResponse, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { hashToken } from "../_shared/tokens.ts";

type TokenRow = {
  participant_id: string;
  expires_at: string | null;
  revoked_at: string | null;
};

type ParticipantRow = {
  id: string;
  company_id: string | null;
  first_name: string;
  last_name: string;
  email: string;
  role: string | null;
  status: string;
  access_mode: string;
  ai_stage: string | null;
  public_company_allowed: boolean;
  networking_allowed: boolean;
  newsletter_allowed: boolean;
};

type CompanyRow = {
  id: string;
  name: string;
  c360_registration_number: string | null;
  industry: string | null;
  company_size_badge: string | null;
  region: string | null;
  logo_url: string | null;
};

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

function accessLabel(accessMode: string): string {
  return accessMode === "full" ? "Pilnā pieeja" : "Pamata pieeja";
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "GET") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const requestUrl = new URL(request.url);
    const token = (requestUrl.searchParams.get("token") || "").trim();
    if (!token) return errorResponse("Token is required", 400);

    const db = new SupabaseRest();
    const tokenHash = await hashToken(token, requiredEnv("TOKEN_PEPPER"));
    const tokenRows = await db.select<TokenRow>("participant_tokens", {
      token_hash: `eq.${tokenHash}`,
      purpose: "eq.magic_link",
      revoked_at: "is.null",
      limit: 1,
    });

    const tokenRow = tokenRows[0];
    if (!tokenRow) return errorResponse("Pass link is invalid", 404);
    if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) {
      return errorResponse("Pass link has expired", 410);
    }

    const participants = await db.select<ParticipantRow>("participants", {
      id: `eq.${tokenRow.participant_id}`,
      limit: 1,
    });
    const participant = participants[0];
    if (!participant) return errorResponse("Participant not found", 404);

    let company: CompanyRow | null = null;
    if (participant.company_id) {
      company = (await db.select<CompanyRow>("companies", {
        id: `eq.${participant.company_id}`,
        limit: 1,
      }))[0] || null;
    }

    return jsonResponse({
      participant: {
        id: participant.id,
        firstName: participant.first_name,
        lastName: participant.last_name,
        email: participant.email,
        role: participant.role || "Dalībnieks",
        status: statusLabel(participant.status),
        access: accessLabel(participant.access_mode),
        aiStage: participant.ai_stage || "",
        publicCompany: participant.public_company_allowed,
        networking: participant.networking_allowed,
        newsletter: participant.newsletter_allowed,
        companyName: company?.name || "Nepārstāv uzņēmumu",
        company,
      },
    });
  } catch (error) {
    return errorResponse("Pass lookup failed", 500, String(error));
  }
});
