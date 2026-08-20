import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { addParticipantToCalendarInvite, logCalendarInvite } from "../_shared/calendar-invite.ts";
import { logEmail, sendEmail } from "../_shared/email.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { addDays, createToken, hashToken } from "../_shared/tokens.ts";

type RegistrationPayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  role?: string;
  companyName?: string;
  company?: {
    name?: string;
    reg?: string;
    registration_number?: string;
    country?: string;
    status?: string;
    legal_form?: string;
    registered_date?: string;
    address?: string;
    nace_code?: string;
    industry?: string;
    nace_text?: string;
    company_size?: string;
    company_size_badge?: string;
    region?: string;
    size?: string;
    sector?: string;
  } | null;
  noCompany?: boolean;
  aiMaturityLevel?: number;
  aiAnonymous?: boolean;
  publicCompany?: boolean;
  fullPortal?: boolean;
  networking?: boolean;
  newsletter?: boolean;
};

type EventRow = {
  id: string;
  slug: string;
  capacity: number;
  auto_approve_enabled: boolean;
  auto_approve_limit: number;
  graph_calendar_user?: string | null;
  microsoft_graph_event_id?: string | null;
};
type CompanyRow = { id: string };
type ParticipantRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone?: string | null;
  status: string;
};
type EmailResult = {
  provider: string;
  status: "queued" | "sent" | "failed";
  provider_message_id?: string;
  error_message?: string;
};

function clean(value?: string): string {
  return (value || "").trim();
}

function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Mirrors the phase boundaries in maturity-levels.js — never trust a client-sent phase. */
function maturityPhase(level: number): string {
  if (level <= 2) return "Izpēte";
  if (level <= 5) return "Eksperimenti";
  if (level <= 8) return "Ieviešana";
  return "Līderis";
}

function companyRow(payload: RegistrationPayload) {
  const company = payload.company;
  const reg = clean(company?.reg || company?.registration_number);
  const name = clean(company?.name || payload.companyName);
  if (!reg && !name) return null;

  return {
    c360_registration_number: reg || null,
    name,
    country: clean(company?.country) || "LV",
    status: clean(company?.status) || null,
    legal_form: clean(company?.legal_form) || null,
    registered_date: clean(company?.registered_date) || null,
    address: clean(company?.address) || null,
    nace_code: clean(company?.nace_code) || null,
    industry: clean(company?.industry || company?.sector) || null,
    nace_text: clean(company?.nace_text) || null,
    company_size: clean(company?.company_size || company?.size) || null,
    company_size_badge: clean(company?.company_size_badge) || null,
    region: clean(company?.region) || null,
    c360_payload: company || {},
    synced_at: reg ? new Date().toISOString() : null,
  };
}

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const events = await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 });
  if (!events[0]) throw new Error(`Event not found: ${slug}`);
  return events[0];
}

async function saveCompany(db: SupabaseRest, payload: RegistrationPayload): Promise<string | null> {
  if (payload.noCompany) return null;
  const row = companyRow(payload);
  if (!row) return null;

  if (row.c360_registration_number) {
    const rows = await db.upsert<CompanyRow>("companies", [row], "c360_registration_number");
    return rows[0]?.id || null;
  }

  const rows = await db.insert<CompanyRow>("companies", [row]);
  return rows[0]?.id || null;
}

async function shouldAutoApprove(db: SupabaseRest, event: EventRow, existing?: ParticipantRow | null) {
  if (!event.auto_approve_enabled || event.auto_approve_limit <= 0) return false;
  if (existing && !["application_received", "reconfirm_required"].includes(existing.status)) return false;
  const approved = await db.select<{ id: string }>("participants", {
    event_id: `eq.${event.id}`,
    status: "in.(approved,arrived)",
    limit: event.capacity + 1,
  });
  return approved.length < Math.min(event.auto_approve_limit, event.capacity);
}

function registrationEmailHtml(firstName: string, passLink: string): string {
  return `
    <div style="margin:0;background:#060606;color:#f4f0e9;font-family:Arial,sans-serif;padding:32px">
      <div style="max-width:620px;margin:0 auto;border:1px solid #25252b;background:#0c0c0f;padding:28px">
        <p style="color:#ff008a;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 16px">AI Reality Check 2026</p>
        <h1 style="font-size:32px;line-height:1.1;margin:0 0 16px">Pieteikums saņemts</h1>
        <p style="font-size:16px;line-height:1.6;color:#c9c4bd;margin:0 0 20px">Sveiki, ${firstName}! Tavs pieteikums AI Reality Check 2026 ir saņemts.</p>
        <p style="font-size:16px;line-height:1.6;color:#c9c4bd;margin:0 0 24px">Dalības statuss un AI Pass ir pieejams zemāk.</p>
        <a href="${passLink}" style="display:inline-block;background:#7a67ee;color:#ffffff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:8px">Atvērt manu AI Pass</a>
        <p style="font-size:13px;line-height:1.6;color:#8d8d96;margin:24px 0 0">30. septembris, 2026 · Rīgas Motormuzejs</p>
      </div>
    </div>
  `;
}

async function sendRegistrationEmail(email: string, firstName: string, passLink: string): Promise<EmailResult> {
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
        subject: "Tavs pieteikums AI Reality Check 2026 ir saņemts",
        html: registrationEmailHtml(firstName, passLink),
        text: `Sveiki, ${firstName}! Tavs pieteikums AI Reality Check 2026 ir saņemts. AI Pass: ${passLink}`,
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

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "POST") {
    return errorResponse("Method not allowed", 405);
  }

  try {
    const db = new SupabaseRest();
    const limited = await rateLimit(db, request, "registrations", 8, 60);
    if (limited) return limited;
    const payload = await readJson<RegistrationPayload>(request);

    // TESTING: return after readJson
    console.log("Payload read successfully, returning test response");
    return jsonResponse({
      participant: { id: `test2-${Date.now()}`, status: "ok", access_mode: "basic" },
      links: { pass: "#", qr_checkin: "#" },
    }, 201);
    const firstName = clean(payload.firstName);
    const lastName = clean(payload.lastName);
    const email = clean(payload.email).toLowerCase();
    const maturityLevel = Number(payload.aiMaturityLevel);

    if (!firstName) return errorResponse("Vārds ir obligāts.");
    if (!lastName) return errorResponse("Uzvārds ir obligāts.");
    if (!validEmail(email)) return errorResponse("E-pasts nav derīgs.");
    if (!clean(payload.phone)) return errorResponse("Telefons ir obligāts.");
    if (!payload.noCompany && !clean(payload.companyName) && !payload.company?.name) {
      return errorResponse("Uzņēmums ir obligāts vai jāatzīmē, ka uzņēmums nav atrasts.");
    }
    if (!Number.isInteger(maturityLevel) || maturityLevel < 1 || maturityLevel > 10) {
      return errorResponse("MI brieduma līmenis ir obligāts (1-10).");
    }

    const event = await getEvent(db);

    // TESTING: return immediately after event lookup
    console.log("Event loaded, returning test response");
    return jsonResponse({
      participant: {
        id: `test-${Date.now()}`,
        status: "testing",
        access_mode: "basic",
      },
      links: { pass: "#", qr_checkin: "#" },
    }, 201);

    const existingParticipant = (await db.select<ParticipantRow>("participants", {
      event_id: `eq.${event.id}`,
      email: `eq.${email}`,
      limit: 1,
    }))[0] || null;
    if (existingParticipant) {
      return errorResponse("Ar šo e-pasta adresi dalībnieks jau ir reģistrēts.", 409, {
        code: "EMAIL_ALREADY_REGISTERED",
        status: existingParticipant.status,
      });
    }
    const companyId = await saveCompany(db, payload);
    const autoApprove = await shouldAutoApprove(db, event);
    const nextStatus = autoApprove ? "approved" : "application_received";

    // Extract phone - preserve non-empty values
    const phoneStr = clean(payload.phone) || null;

    // TESTING: Skip insert, just return success
    console.log("SKIPPING INSERT - returning dummy response");
    return jsonResponse({
      participant: {
        id: `debug-${Date.now()}`,
        status: nextStatus,
        access_mode: payload.fullPortal ? "full" : "basic",
      },
      links: {
        pass: "#",
        qr_checkin: "#",
      },
    }, 201);

    console.log("Inserting participant with phone:", phoneStr);
    let participantRows;
    try {
      participantRows = await db.insert<ParticipantRow>("participants", [{
        event_id: event.id,
        company_id: companyId,
        first_name: firstName,
        last_name: lastName,
        email,
        phone: phoneStr,
        role: clean(payload.role) || null,
        status: nextStatus,
        approved_at: autoApprove ? new Date().toISOString() : null,
        access_mode: payload.fullPortal ? "full" : "basic",
        ai_maturity_level: maturityLevel,
        ai_maturity_phase: maturityPhase(maturityLevel),
        ai_maturity_anonymous: Boolean(payload.aiAnonymous),
        ai_maturity_answered_at: new Date().toISOString(),
        ai_maturity_version: 1,
        public_company_allowed: Boolean(payload.publicCompany),
        networking_allowed: Boolean(payload.networking),
        newsletter_allowed: Boolean(payload.newsletter),
      }]);
      console.log("Participant inserted successfully:", participantRows[0]?.id);
    } catch (e) {
      console.error("Participant insert failed:", e);
      throw e;
    }

    const participant = participantRows[0];
    if (!participant?.id) throw new Error("Participant was not saved");

    // TEMPORARY: Skip everything after insert for debugging
    return jsonResponse({
      participant: {
        id: participant.id,
        status: nextStatus,
        access_mode: payload.fullPortal ? "full" : "basic",
      },
      links: {
        pass: `${(Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "")}/pass/?token=debug`,
        qr_checkin: "#",
      },
    }, 201);

    // OLD CODE DISABLED:
    try {
      await db.upsert("consents", [
        { participant_id: participant.id, consent_key: "required_participation", granted: true, source: "registration" },
        { participant_id: participant.id, consent_key: "public_company", granted: Boolean(payload.publicCompany), source: "registration" },
        { participant_id: participant.id, consent_key: "full_portal", granted: Boolean(payload.fullPortal), source: "registration" },
        { participant_id: participant.id, consent_key: "networking", granted: Boolean(payload.networking), source: "registration" },
        { participant_id: participant.id, consent_key: "newsletter", granted: Boolean(payload.newsletter), source: "registration" },
      ], "participant_id,consent_key");
      console.log("Consents upserted successfully");
    } catch (e) {
      console.error("Consents upsert failed:", e);
      throw e;
    }

    const pepper = requiredEnv("TOKEN_PEPPER");
    const ttlDays = Number(Deno.env.get("MAGIC_LINK_TTL_DAYS") || "90");
    const magicToken = createToken();
    const qrToken = createToken();
    try {
      await db.insert("participant_tokens", [
        {
          participant_id: participant.id,
          purpose: "magic_link",
          token_hash: await hashToken(magicToken, pepper),
          expires_at: addDays(new Date(), ttlDays),
        },
        {
          participant_id: participant.id,
          purpose: "qr_checkin",
          token_hash: await hashToken(qrToken, pepper),
          expires_at: addDays(new Date(), ttlDays),
        },
      ]);
      console.log("Tokens inserted successfully");
    } catch (e) {
      console.error("Tokens insert failed:", e);
      throw e;
    }

    const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
    const passLink = `${siteUrl}/pass/?token=${magicToken}`;
    const checkinLink = `${siteUrl}/checkin/?token=${qrToken}`;
    const functionsUrl = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "")}/functions/v1`;
    const appleWalletLink = `${functionsUrl}/wallet?provider=apple&redirect=1&token=${magicToken}`;
    const googleWalletLink = `${functionsUrl}/wallet?provider=google&token=${magicToken}`;

    // Skip email/calendar on first deployment to test core registration
    console.log("Skipping email/calendar for now");

    return jsonResponse({
      participant: {
        id: participant.id,
        status: nextStatus,
        access_mode: payload.fullPortal ? "full" : "basic",
      },
      links: {
        pass: passLink,
        qr_checkin: checkinLink,
      },
    }, 201);
  } catch (error) {
    console.error("Registration error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Stack:", error.stack);
    }
    return errorResponse("Registration failed", 500, String(error));
  }
});
