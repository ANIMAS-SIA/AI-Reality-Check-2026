import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { addParticipantToCalendarInvite, logCalendarInvite } from "../_shared/calendar-invite.ts";
import { logEmail, sendEmail } from "../_shared/email.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { addDays, createToken, hashToken } from "../_shared/tokens.ts";

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
  ai_stage: string | null;
  networking_allowed?: boolean;
  newsletter_allowed?: boolean;
  attendance_reconfirmed_at?: string | null;
  created_at: string;
};

type EventRow = {
  id: string;
  capacity: number;
  name: string;
  auto_approve_enabled: boolean;
  auto_approve_limit: number;
  graph_calendar_user?: string | null;
  microsoft_graph_event_id?: string | null;
};

type EmailResult = {
  provider: string;
  status: "queued" | "sent" | "failed";
  provider_message_id?: string;
  error_message?: string;
};

type UpdatePayload = Partial<{
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  status: string;
  accessMode: string;
  aiStage: string;
  networkingAllowed: boolean;
  newsletterAllowed: boolean;
}>;

type SettingsPayload = Partial<{
  autoApproveEnabled: boolean;
  autoApproveLimit: number;
  graphCalendarUser: string;
  microsoftGraphEventId: string;
}>;

function clean(value?: string | null): string {
  return (value || "").trim();
}

function requireAdmin(request: Request): Response | null {
  const expected = Deno.env.get("ADMIN_API_KEY");
  if (!expected) return errorResponse("ADMIN_API_KEY is not configured", 500);
  const actual = request.headers.get("x-admin-key") || "";
  if (actual !== expected) return errorResponse("Unauthorized", 401);
  return null;
}

function approvedEmailHtml(firstName: string, passLink: string, checkinLink: string, appleWalletLink: string, googleWalletLink: string): string {
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(checkinLink)}`;
  return `
    <div style="margin:0;background:#060606;color:#f4f0e9;font-family:Arial,sans-serif;padding:32px">
      <div style="max-width:620px;margin:0 auto;border:1px solid #25252b;background:#0c0c0f;padding:28px">
        <p style="color:#38e59c;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 16px">Dalība apstiprināta</p>
        <h1 style="font-size:32px;line-height:1.1;margin:0 0 16px">Tava vieta ir apstiprināta</h1>
        <p style="font-size:16px;line-height:1.6;color:#c9c4bd;margin:0 0 20px">Sveiki, ${firstName}! Tava vieta AI Reality Check 2026 ir apstiprināta.</p>
        <a href="${passLink}" style="display:inline-block;background:#7a67ee;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:8px">Atvērt manu AI Pass</a>
        <div style="margin-top:12px">
          <a href="${appleWalletLink}" style="display:inline-block;border:1px solid #25252b;color:#f4f0e9;text-decoration:none;font-weight:700;padding:12px 14px;border-radius:8px;margin-right:8px">Apple Wallet</a>
          <a href="${googleWalletLink}" style="display:inline-block;border:1px solid #25252b;color:#f4f0e9;text-decoration:none;font-weight:700;padding:12px 14px;border-radius:8px">Google Wallet</a>
        </div>
        <div style="margin-top:28px;padding:18px;border:1px solid #25252b;background:#060606;display:inline-block">
          <img src="${qrSrc}" width="180" height="180" alt="QR kods ieejai" style="display:block;background:#fff">
        </div>
        <p style="font-size:13px;line-height:1.6;color:#8d8d96;margin:24px 0 0">QR kods satur tikai unikālu dalības identifikatoru.</p>
        <p style="font-size:13px;line-height:1.6;color:#8d8d96;margin:8px 0 0">30. septembris, 2026 · Rīgas Motormuzejs</p>
      </div>
    </div>
  `;
}

async function sendApprovedEmail(email: string, firstName: string, passLink: string, checkinLink: string, appleWalletLink: string, googleWalletLink: string): Promise<EmailResult> {
  const provider = Deno.env.get("EMAIL_PROVIDER") || "resend";
  if (provider !== "resend") return { provider, status: "queued" };
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { provider, status: "queued", error_message: "RESEND_API_KEY is not set" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") || "AI Reality Check <onboarding@resend.dev>",
        to: [email],
        subject: "Tava vieta AI Reality Check 2026 ir apstiprināta",
        html: approvedEmailHtml(firstName, passLink, checkinLink, appleWalletLink, googleWalletLink),
        text: `Sveiki, ${firstName}! Tava vieta AI Reality Check 2026 ir apstiprināta. AI Pass: ${passLink}`,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { provider, status: "failed", error_message: data.message || `Resend failed: ${response.status}` };
    }
    return { provider, status: "sent", provider_message_id: data.id };
  } catch (error) {
    return { provider, status: "failed", error_message: String(error) };
  }
}

async function findOrCreateMagicToken(db: SupabaseRest, participantId: string): Promise<string> {
  const pepper = requiredEnv("TOKEN_PEPPER");
  const ttlDays = Number(Deno.env.get("MAGIC_LINK_TTL_DAYS") || "90");
  const magicToken = createToken();
  await db.insert("participant_tokens", [{
    participant_id: participantId,
    purpose: "magic_link",
    token_hash: await hashToken(magicToken, pepper),
    expires_at: addDays(new Date(), ttlDays),
  }]);
  return magicToken;
}

async function createQrToken(db: SupabaseRest, participantId: string): Promise<string> {
  await db.update("participant_tokens", { revoked_at: new Date().toISOString() }, {
    participant_id: `eq.${participantId}`,
    purpose: "eq.qr_checkin",
    revoked_at: "is.null",
  });

  const qrToken = createToken();
  await db.insert("participant_tokens", [{
    participant_id: participantId,
    purpose: "qr_checkin",
    token_hash: await hashToken(qrToken, requiredEnv("TOKEN_PEPPER")),
    expires_at: addDays(new Date(), Number(Deno.env.get("MAGIC_LINK_TTL_DAYS") || "90")),
  }]);
  return qrToken;
}

async function listRegistrations(db: SupabaseRest): Promise<Response> {
  return jsonResponse({ registrations: await queryRegistrations(db, new URL("https://local/")) });
}

async function queryRegistrations(db: SupabaseRest, url: URL): Promise<ParticipantRow[]> {
  const query: Record<string, string | number> = {
    order: "created_at.desc",
    limit: Number(url.searchParams.get("limit") || "250"),
  };
  const status = url.searchParams.get("status");
  if (status && status !== "all") query.status = `eq.${status}`;
  const rows = await db.select<ParticipantRow>("participants", {
    ...query,
  });
  return rows;
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

async function exportRegistrations(db: SupabaseRest, url: URL): Promise<Response> {
  const rows = await queryRegistrations(db, url);
  const header = ["id", "first_name", "last_name", "email", "role", "status", "access_mode", "ai_stage", "created_at"];
  const body = rows.map((row) => header.map((key) => csvCell((row as unknown as Record<string, unknown>)[key])).join(","));
  return new Response([header.join(","), ...body].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-reality-check-registrations.csv"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

async function checkinStats(db: SupabaseRest): Promise<Response> {
  const participants = await db.select<ParticipantRow>("participants", { limit: 1000 });
  const checkins = await db.select<{ id: string; scan_result: string }>("checkins", { limit: 2000 });
  const byStatus = participants.reduce<Record<string, number>>((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  return jsonResponse({
    participants: participants.length,
    arrived: participants.filter((row) => row.status === "arrived").length,
    approved: participants.filter((row) => row.status === "approved").length,
    checkins: checkins.length,
    duplicate_scans: checkins.filter((row) => row.scan_result === "duplicate").length,
    by_status: byStatus,
  });
}

async function audit(db: SupabaseRest, request: Request, action: string, targetId?: string, metadata: Record<string, unknown> = {}) {
  const key = request.headers.get("x-admin-key") || "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await db.insert("admin_audit_logs", [{
    actor_key_hash: hash,
    action,
    target_table: targetId ? "participants" : null,
    target_id: targetId || null,
    metadata,
  }]);
}

async function eventSettings(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function getSettings(db: SupabaseRest): Promise<Response> {
  const event = await eventSettings(db);
  const approved = await db.select<{ id: string }>("participants", {
    event_id: `eq.${event.id}`,
    status: "in.(approved,arrived)",
    limit: event.capacity + 1,
  });
  return jsonResponse({
    settings: {
      event_id: event.id,
      capacity: event.capacity,
      approved_count: approved.length,
      auto_approve_enabled: event.auto_approve_enabled,
      auto_approve_limit: event.auto_approve_limit,
      graph_calendar_user: event.graph_calendar_user || "konference@animas.lv",
      microsoft_graph_event_id: event.microsoft_graph_event_id || "",
    },
  });
}

async function updateSettings(db: SupabaseRest, request: Request, payload: SettingsPayload): Promise<Response> {
  const event = await eventSettings(db);
  const row = {
    auto_approve_enabled: Boolean(payload.autoApproveEnabled),
    auto_approve_limit: Math.max(0, Math.min(Number(payload.autoApproveLimit || 0), event.capacity)),
    graph_calendar_user: clean(payload.graphCalendarUser) || "konference@animas.lv",
    microsoft_graph_event_id: clean(payload.microsoftGraphEventId) || null,
  };
  const updated = (await db.update<EventRow>("events", row, { id: `eq.${event.id}` }))[0];
  await audit(db, request, "event_auto_approval_settings_update", event.id, row);
  return jsonResponse({ settings: updated });
}

async function approveRegistration(db: SupabaseRest, participantId: string): Promise<Response> {
  const participants = await db.select<ParticipantRow>("participants", {
    id: `eq.${participantId}`,
    limit: 1,
  });
  const participant = participants[0];
  if (!participant) return errorResponse("Participant not found", 404);

  const events = await db.select<EventRow>("events", { id: `eq.${participant.event_id}`, limit: 1 });
  const event = events[0];
  if (!event) return errorResponse("Event not found", 404);

  const approved = await db.select<{ id: string }>("participants", {
    event_id: `eq.${participant.event_id}`,
    status: "eq.approved",
  });
  if (participant.status !== "approved" && approved.length >= event.capacity) {
    return errorResponse("Event capacity is full", 409, { capacity: event.capacity });
  }

  const updated = await db.update<ParticipantRow>("participants", {
    status: "approved",
    approved_at: new Date().toISOString(),
  }, { id: `eq.${participantId}` });
  const approvedParticipant = updated[0] || participant;

  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
  const magicToken = await findOrCreateMagicToken(db, participantId);
  const qrToken = await createQrToken(db, participantId);
  const passLink = `${siteUrl}/pass/?token=${magicToken}`;
  const checkinLink = `${siteUrl}/checkin/?token=${qrToken}`;
  const functionsUrl = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "")}/functions/v1`;
  const appleWalletLink = `${functionsUrl}/wallet?provider=apple&token=${magicToken}`;
  const googleWalletLink = `${functionsUrl}/wallet?provider=google&token=${magicToken}`;
  const calendarResult = await addParticipantToCalendarInvite(event, {
    id: participant.id,
    first_name: participant.first_name,
    last_name: participant.last_name,
    email: participant.email,
  });
  await logCalendarInvite(db, event, {
    id: participant.id,
    first_name: participant.first_name,
    last_name: participant.last_name,
    email: participant.email,
  }, calendarResult);

  const emailResult = await sendEmail(participant.email, "participation_approved", {
    firstName: participant.first_name,
    participantName: `${participant.first_name} ${participant.last_name}`.trim(),
    companyName: "",
    ticketCode: `ARC-2026-${participant.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
    passLink,
    checkinLink,
    appleWalletLink,
    googleWalletLink,
  });

  await db.insert("email_deliveries", [{
    participant_id: participant.id,
    template_key: "participation_approved",
    provider: emailResult.provider,
    provider_message_id: emailResult.provider_message_id || null,
    status: emailResult.status,
    subject: emailResult.subject || "Tava vieta AI Reality Check 2026 ir apstiprināta",
    sent_to: participant.email,
    payload: {
      first_name: participant.first_name,
      event_name: event.name,
      pass_link: passLink,
      checkin_link: checkinLink,
      apple_wallet_link: appleWalletLink,
      google_wallet_link: googleWalletLink,
      calendar_invite: calendarResult.status,
    },
    error_message: emailResult.error_message || null,
  }]);

  return jsonResponse({
    participant: approvedParticipant,
    links: { pass: passLink, qr_checkin: checkinLink },
    email: emailResult,
    calendar: calendarResult,
  });
}

async function participantLinks(db: SupabaseRest, participantId: string) {
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
  const magicToken = await findOrCreateMagicToken(db, participantId);
  return { passLink: `${siteUrl}/pass/?token=${magicToken}` };
}

async function setParticipantStatus(db: SupabaseRest, request: Request, participantId: string, status: string): Promise<Response> {
  if (!["waitlisted", "rejected", "cancelled", "reconfirm_required"].includes(status)) {
    return errorResponse("Unsupported status", 400);
  }
  const participant = (await db.select<ParticipantRow>("participants", { id: `eq.${participantId}`, limit: 1 }))[0];
  if (!participant) return errorResponse("Participant not found", 404);
  const updated = (await db.update<ParticipantRow>("participants", { status }, { id: `eq.${participantId}` }))[0];
  const templateKey = status === "waitlisted"
    ? "waitlist"
    : status === "rejected"
      ? "rejected"
      : status === "reconfirm_required"
        ? "reconfirm_7_days"
        : "reminder";
  const { passLink } = await participantLinks(db, participantId);
  const result = await sendEmail(participant.email, templateKey, { firstName: participant.first_name, passLink });
  await logEmail(db, participantId, templateKey, participant.email, result, { pass_link: passLink });
  await audit(db, request, `participant_${status}`, participantId);
  return jsonResponse({ participant: updated, email: result });
}

async function sendTemplateToParticipant(db: SupabaseRest, request: Request, participantId: string, templateKey: string): Promise<Response> {
  const allowed = ["reminder", "reconfirm_7_days", "post_event_materials", "waitlist", "rejected"];
  if (!allowed.includes(templateKey)) return errorResponse("Unsupported template", 400);
  const participant = (await db.select<ParticipantRow>("participants", { id: `eq.${participantId}`, limit: 1 }))[0];
  if (!participant) return errorResponse("Participant not found", 404);
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
  const { passLink } = await participantLinks(db, participantId);
  const result = await sendEmail(participant.email, templateKey, {
    firstName: participant.first_name,
    passLink,
    resultsLink: `${siteUrl}/rezultati/`,
  });
  await logEmail(db, participantId, templateKey, participant.email, result, { pass_link: passLink });
  await audit(db, request, `email_${templateKey}`, participantId);
  return jsonResponse({ email: result });
}

async function updateParticipant(db: SupabaseRest, request: Request, participantId: string, payload: UpdatePayload): Promise<Response> {
  const row: Record<string, unknown> = {};
  if (payload.firstName !== undefined) row.first_name = payload.firstName.trim();
  if (payload.lastName !== undefined) row.last_name = payload.lastName.trim();
  if (payload.email !== undefined) row.email = payload.email.trim().toLowerCase();
  if (payload.role !== undefined) row.role = payload.role.trim() || null;
  if (payload.status !== undefined) row.status = payload.status;
  if (payload.accessMode !== undefined) row.access_mode = payload.accessMode;
  if (payload.aiStage !== undefined) row.ai_stage = payload.aiStage.trim() || null;
  if (payload.networkingAllowed !== undefined) row.networking_allowed = payload.networkingAllowed;
  if (payload.newsletterAllowed !== undefined) row.newsletter_allowed = payload.newsletterAllowed;
  const updated = await db.update<ParticipantRow>("participants", row, { id: `eq.${participantId}` });
  await audit(db, request, "participant_update", participantId, { fields: Object.keys(row) });
  return jsonResponse({ participant: updated[0] });
}

async function revokeTokens(db: SupabaseRest, request: Request, participantId: string, purpose: string): Promise<Response> {
  const query: Record<string, string> = { participant_id: `eq.${participantId}`, revoked_at: "is.null" };
  if (purpose !== "all") query.purpose = `eq.${purpose}`;
  await db.update("participant_tokens", { revoked_at: new Date().toISOString() }, query);
  await audit(db, request, "tokens_revoked", participantId, { purpose });
  return jsonResponse({ ok: true });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const adminError = requireAdmin(request);
  if (adminError) return adminError;

  try {
    const db = new SupabaseRest();
    const url = new URL(request.url);

    if (request.method === "GET") {
      const action = url.searchParams.get("action");
      if (action === "settings") return await getSettings(db);
      if (action === "export") return await exportRegistrations(db, url);
      if (action === "stats") return await checkinStats(db);
      const rows = await queryRegistrations(db, url);
      return jsonResponse({ registrations: rows });
    }

    if (request.method === "POST") {
      const action = url.searchParams.get("action");
      const participantId = url.searchParams.get("participant_id");
      if (action === "approve" && participantId) {
        return await approveRegistration(db, participantId);
      }
      if (participantId && ["waitlist", "reject", "cancel", "reconfirm"].includes(action || "")) {
        const status = action === "waitlist" ? "waitlisted" : action === "reject" ? "rejected" : action === "reconfirm" ? "reconfirm_required" : "cancelled";
        return await setParticipantStatus(db, request, participantId, status);
      }
      if (action === "send-email" && participantId) {
        return await sendTemplateToParticipant(db, request, participantId, url.searchParams.get("template") || "");
      }
      if (action === "revoke-tokens" && participantId) {
        return await revokeTokens(db, request, participantId, url.searchParams.get("purpose") || "all");
      }
      if (action === "update" && participantId) {
        return await updateParticipant(db, request, participantId, await request.json());
      }
      if (action === "settings") {
        return await updateSettings(db, request, await readJson<SettingsPayload>(request));
      }
      return errorResponse("Unsupported admin action", 400);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Admin registrations failed", 500, String(error));
  }
});
