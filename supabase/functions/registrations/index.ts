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
  aiStage?: string;
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
    const firstName = clean(payload.firstName);
    const lastName = clean(payload.lastName);
    const email = clean(payload.email).toLowerCase();
    const aiStage = clean(payload.aiStage);

    if (!firstName) return errorResponse("Vārds ir obligāts.");
    if (!lastName) return errorResponse("Uzvārds ir obligāts.");
    if (!validEmail(email)) return errorResponse("Darba e-pasts nav derīgs.");
    if (!payload.noCompany && !clean(payload.companyName) && !payload.company?.name) {
      return errorResponse("Uzņēmums ir obligāts vai jāatzīmē, ka uzņēmums nav atrasts.");
    }
    if (!aiStage) return errorResponse("AI Reality Check atbilde ir obligāta.");

    const event = await getEvent(db);
    const companyId = await saveCompany(db, payload);
    const existingParticipant = (await db.select<ParticipantRow>("participants", {
      event_id: `eq.${event.id}`,
      email: `eq.${email}`,
      limit: 1,
    }))[0] || null;
    const autoApprove = await shouldAutoApprove(db, event, existingParticipant);
    const nextStatus = autoApprove ? "approved" : existingParticipant?.status || "application_received";

    const participantRows = await db.upsert<ParticipantRow>("participants", [{
      event_id: event.id,
      company_id: companyId,
      first_name: firstName,
      last_name: lastName,
      email,
      role: clean(payload.role) || null,
      status: nextStatus,
      approved_at: autoApprove ? new Date().toISOString() : undefined,
      access_mode: payload.fullPortal ? "full" : "basic",
      ai_stage: aiStage,
      ai_stage_is_anonymous: Boolean(payload.aiAnonymous),
      public_company_allowed: Boolean(payload.publicCompany),
      networking_allowed: Boolean(payload.networking),
      newsletter_allowed: Boolean(payload.newsletter),
    }], "event_id,email");

    const participant = participantRows[0];
    if (!participant?.id) throw new Error("Participant was not saved");

    await db.upsert("consents", [
      { participant_id: participant.id, consent_key: "required_participation", granted: true, source: "registration" },
      { participant_id: participant.id, consent_key: "public_company", granted: Boolean(payload.publicCompany), source: "registration" },
      { participant_id: participant.id, consent_key: "full_portal", granted: Boolean(payload.fullPortal), source: "registration" },
      { participant_id: participant.id, consent_key: "networking", granted: Boolean(payload.networking), source: "registration" },
      { participant_id: participant.id, consent_key: "newsletter", granted: Boolean(payload.newsletter), source: "registration" },
    ], "participant_id,consent_key");

    const pepper = requiredEnv("TOKEN_PEPPER");
    const ttlDays = Number(Deno.env.get("MAGIC_LINK_TTL_DAYS") || "90");
    const magicToken = createToken();
    const qrToken = createToken();
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

    const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
    const passLink = `${siteUrl}/pass/?token=${magicToken}`;
    const checkinLink = `${siteUrl}/checkin/?token=${qrToken}`;
    const functionsUrl = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "")}/functions/v1`;
    const appleWalletLink = `${functionsUrl}/wallet?provider=apple&token=${magicToken}`;
    const googleWalletLink = `${functionsUrl}/wallet?provider=google&token=${magicToken}`;

    if (autoApprove) {
      const calendarResult = await addParticipantToCalendarInvite(event, {
        id: participant.id,
        first_name: firstName,
        last_name: lastName,
        email,
      });
      await logCalendarInvite(db, event, {
        id: participant.id,
        first_name: firstName,
        last_name: lastName,
        email,
      }, calendarResult);

      const emailResult = await sendEmail(email, "participation_approved", {
        firstName,
        participantName: `${firstName} ${lastName}`.trim(),
        companyName: clean(payload.companyName || payload.company?.name) || "",
        ticketCode: `ARC-2026-${participant.id.replaceAll("-", "").slice(0, 8).toUpperCase()}`,
        passLink,
        checkinLink,
        appleWalletLink,
        googleWalletLink,
      });
      await logEmail(db, participant.id, "participation_approved", email, emailResult, {
        first_name: firstName,
        event_name: "AI Reality Check 2026",
        pass_link: passLink,
        checkin_link: checkinLink,
        apple_wallet_link: appleWalletLink,
        google_wallet_link: googleWalletLink,
        calendar_invite: calendarResult.status,
      });
    } else {
      const emailResult = await sendEmail(email, "registration_received", {
        firstName,
        passLink,
        registrationNumber: participant.id,
      });
      await db.insert("email_deliveries", [{
        participant_id: participant.id,
        template_key: "registration_received",
        provider: emailResult.provider,
        provider_message_id: emailResult.provider_message_id || null,
        status: emailResult.status,
        subject: "Tavs pieteikums AI Reality Check 2026 ir saņemts",
        sent_to: email,
        payload: {
          first_name: firstName,
          event_name: "AI Reality Check 2026",
          pass_link: passLink,
        },
        error_message: emailResult.error_message || null,
      }]);
    }

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
    return errorResponse("Registration failed", 500, String(error));
  }
});
