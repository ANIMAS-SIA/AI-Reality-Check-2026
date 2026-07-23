import { participationApprovedTemplate, registrationReceivedTemplate } from "./email-designs.ts";
import { SupabaseRest } from "./supabase-rest.ts";

export type EmailResult = {
  provider: string;
  status: "queued" | "sent" | "failed";
  provider_message_id?: string;
  error_message?: string;
};

type TemplateInput = {
  firstName: string;
  passLink?: string;
  checkinLink?: string;
  resultsLink?: string;
  appleWalletLink?: string;
  googleWalletLink?: string;
  registrationNumber?: string;
  participantName?: string;
  companyName?: string;
  ticketCode?: string;
};

const eventLine = "30. septembris, 2026 · Rīgas Motormuzejs";

function shell(label: string, title: string, body: string, cta?: { label: string; href: string }) {
  return `
    <div style="margin:0;background:#060606;color:#f4f0e9;font-family:Arial,sans-serif;padding:32px">
      <div style="max-width:620px;margin:0 auto;border:1px solid #25252b;background:#0c0c0f;padding:28px">
        <p style="color:#ff008a;font-size:12px;font-weight:700;text-transform:uppercase;margin:0 0 16px">${label}</p>
        <h1 style="font-size:32px;line-height:1.1;margin:0 0 16px">${title}</h1>
        <div style="font-size:16px;line-height:1.6;color:#c9c4bd;margin:0 0 22px">${body}</div>
        ${cta ? `<a href="${cta.href}" style="display:inline-block;background:#7a67ee;color:#fff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:8px">${cta.label}</a>` : ""}
        <p style="font-size:13px;line-height:1.6;color:#8d8d96;margin:24px 0 0">${eventLine}</p>
      </div>
    </div>
  `;
}

function replacePlaceholders(input: string, values: Record<string, string>) {
  return Object.entries(values).reduce((html, [key, value]) => html.replaceAll(`{{${key}}}`, value), input);
}

function calendarUrl() {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: "AI Reality Check 2026",
    dates: "20260930T060000Z/20260930T120000Z",
    location: "Rīgas Motormuzejs, Sergeja Eizenšteina iela 8, Rīga",
    details: "AI Reality Check 2026 konference.",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function logoUrl() {
  return Deno.env.get("EMAIL_LOGO_URL")
    || `${(Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "")}/C360-logo-balts.png`;
}

function qrUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=16&data=${encodeURIComponent(value)}`;
}

function ticketCode(input: TemplateInput) {
  const seed = input.ticketCode || input.registrationNumber || input.passLink || input.firstName || "pass";
  return input.ticketCode || `ARC-2026-${seed.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
}

export function renderEmail(templateKey: string, input: TemplateInput) {
  const firstName = input.firstName || "Sveiki";
  const passUrl = input.passLink || input.resultsLink || "#";
  const code = ticketCode(input);
  const common = {
    firstName,
    registrationNumber: input.registrationNumber || code,
    statusUrl: passUrl,
    participantName: input.participantName || firstName,
    companyName: input.companyName || "",
    ticketCode: code,
    passUrl,
    appleWalletUrl: input.appleWalletLink || passUrl,
    googleWalletUrl: input.googleWalletLink || passUrl,
    calendarUrl: calendarUrl(),
  };
  const designedRegistration = replacePlaceholders(registrationReceivedTemplate, common)
    .replaceAll("cid:animas-logo", logoUrl());
  const designedApproved = replacePlaceholders(participationApprovedTemplate, common)
    .replaceAll("cid:animas-logo", logoUrl())
    .replaceAll("cid:ticket-qr", qrUrl(input.checkinLink || passUrl));
  const templates: Record<string, { subject: string; html: string; text: string }> = {
    registration_received: {
      subject: "Tavs pieteikums AI Reality Check 2026 ir saņemts",
      html: designedRegistration,
      text: `Sveiki, ${firstName}! Tavs pieteikums AI Reality Check 2026 ir saņemts. Statuss: ${passUrl}`,
    },
    participation_approved: {
      subject: "Tava vieta AI Reality Check 2026 ir apstiprināta",
      html: designedApproved,
      text: `Sveiki, ${firstName}! Tava vieta AI Reality Check 2026 ir apstiprināta. AI Pass: ${passUrl}`,
    },
    waitlist: {
      subject: "Tu esi AI Reality Check 2026 gaidīšanas sarakstā",
      html: shell("Gaidīšanas saraksts", "Pieteikums gaidīšanas sarakstā", `<p>Sveiki, ${firstName}! Šobrīd vietas ir rezervētas, bet mēs tevi informēsim, tiklīdz vieta atbrīvosies.</p>`, input.passLink ? { label: "Skatīt statusu", href: input.passLink } : undefined),
      text: `Sveiki, ${firstName}! Tu esi AI Reality Check 2026 gaidīšanas sarakstā. ${input.passLink || ""}`,
    },
    rejected: {
      subject: "AI Reality Check 2026 pieteikuma statuss",
      html: shell("Pieteikuma statuss", "Pieteikumu nevaram apstiprināt", `<p>Sveiki, ${firstName}! Diemžēl šoreiz nevaram apstiprināt dalību ierobežotā vietu skaita dēļ.</p>`),
      text: `Sveiki, ${firstName}! Diemžēl šoreiz nevaram apstiprināt dalību AI Reality Check 2026.`,
    },
    reminder: {
      subject: "Atgādinājums: AI Reality Check 2026 tuvojas",
      html: shell("Atgādinājums", "Tiekamies AI Reality Check 2026", `<p>Sveiki, ${firstName}! Atgādinām par konferenci. AI Pass būs vajadzīgs pie ieejas.</p>`, input.passLink ? { label: "Atvērt AI Pass", href: input.passLink } : undefined),
      text: `Sveiki, ${firstName}! Atgādinām par AI Reality Check 2026. AI Pass: ${input.passLink || ""}`,
    },
    reconfirm_7_days: {
      subject: "Apstiprini ierašanos AI Reality Check 2026",
      html: shell("Ierašanās apstiprināšana", "Vai būsi klāt?", `<p>Sveiki, ${firstName}! Lūdzu apstiprini ierašanos, lai varam korekti plānot vietas.</p>`, input.passLink ? { label: "Apstiprināt AI Pass", href: input.passLink } : undefined),
      text: `Sveiki, ${firstName}! Lūdzu apstiprini ierašanos AI Reality Check 2026. ${input.passLink || ""}`,
    },
    post_event_materials: {
      subject: "AI Reality Check 2026 materiāli un rezultāti",
      html: shell("Materiāli un rezultāti", "Konferences kopsavilkums ir pieejams", `<p>Sveiki, ${firstName}! Paldies par dalību. Materiāli, jautājumi un rezultāti ir publicēti arhīvā.</p>`, input.resultsLink ? { label: "Atvērt rezultātus", href: input.resultsLink } : undefined),
      text: `Sveiki, ${firstName}! AI Reality Check 2026 materiāli un rezultāti: ${input.resultsLink || ""}`,
    },
  };
  return templates[templateKey] || templates.reminder;
}

export async function sendEmail(to: string, templateKey: string, input: TemplateInput): Promise<EmailResult & { subject: string }> {
  const template = renderEmail(templateKey, input);
  const provider = Deno.env.get("EMAIL_PROVIDER") || "resend";
  if (provider !== "resend") return { provider, status: "queued", subject: template.subject };
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { provider, status: "queued", subject: template.subject, error_message: "RESEND_API_KEY is not set" };

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: Deno.env.get("EMAIL_FROM") || "AI Reality Check <onboarding@resend.dev>",
        to: [to],
        subject: template.subject,
        html: template.html,
        text: template.text,
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { provider, status: "failed", subject: template.subject, error_message: data.message || `Resend failed: ${response.status}` };
    return { provider, status: "sent", subject: template.subject, provider_message_id: data.id };
  } catch (error) {
    return { provider, status: "failed", subject: template.subject, error_message: String(error) };
  }
}

export async function logEmail(db: SupabaseRest, participantId: string | null, templateKey: string, sentTo: string, result: EmailResult & { subject: string }, payload: Record<string, unknown> = {}) {
  await db.insert("email_deliveries", [{
    participant_id: participantId,
    template_key: templateKey,
    provider: result.provider,
    provider_message_id: result.provider_message_id || null,
    status: result.status,
    subject: result.subject,
    sent_to: sentTo,
    payload,
    error_message: result.error_message || null,
  }]);
}
