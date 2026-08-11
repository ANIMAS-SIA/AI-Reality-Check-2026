import { errorResponse, handleOptions, jsonResponse, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { hashToken } from "../_shared/tokens.ts";
import {
  buildApplePassBody,
  createApplePass,
  formatWalletCompanyName,
  logPerkPassError,
  perkPassUserMessage,
  PerkPassApiError,
  syncApplePassIfExists,
} from "../_shared/perkpass.ts";

type TokenRow = { participant_id: string; expires_at: string | null; revoked_at: string | null };
type ParticipantRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  company_id: string | null;
};
type CompanyRow = { id: string; name: string; legal_form: string | null };
type WalletPassRow = {
  serial_number: string | null;
  payload: { share_url?: string; barcode_value?: string } | null;
};
type GoogleServiceAccount = {
  client_email: string;
  private_key: string;
};

async function resolveParticipant(db: SupabaseRest, token: string): Promise<ParticipantRow | null> {
  const tokenHash = await hashToken(token, requiredEnv("TOKEN_PEPPER"));
  const tokenRow = (await db.select<TokenRow>("participant_tokens", {
    token_hash: `eq.${tokenHash}`,
    purpose: "eq.magic_link",
    revoked_at: "is.null",
    limit: 1,
  }))[0];
  if (!tokenRow) return null;
  return (await db.select<ParticipantRow>("participants", {
    id: `eq.${tokenRow.participant_id}`,
    limit: 1,
  }))[0] || null;
}

async function resolveCompanyName(db: SupabaseRest, companyId: string | null): Promise<string> {
  if (!companyId) return "";
  const company = (await db.select<CompanyRow>("companies", {
    id: `eq.${companyId}`,
    limit: 1,
  }))[0];
  return company ? formatWalletCompanyName(company.name, company.legal_form || "") : "";
}

function applePassResponse(request: Request, url: URL, shareUrl: string): Response {
  const directNavigation = request.headers.get("accept")?.includes("text/html");
  return url.searchParams.get("redirect") === "1" || directNavigation
    ? Response.redirect(shareUrl, 302)
    : jsonResponse({ shareUrl });
}

function base64Url(input: string | ArrayBuffer) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function readGoogleServiceAccount(): GoogleServiceAccount | null {
  const raw = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON");
  const rawBase64 = Deno.env.get("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64");
  try {
    const json = rawBase64 ? atob(rawBase64) : raw;
    return json ? JSON.parse(json) as GoogleServiceAccount : null;
  } catch {
    return null;
  }
}

function pkcs8FromPem(privateKey: string) {
  const pem = privateKey.replace(/\\n/g, "\n");
  const base64 = pem
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function walletId(issuerId: string, suffix: string) {
  return suffix.includes(".") ? suffix : `${issuerId}.${suffix}`;
}

async function signGoogleJwt(payload: Record<string, unknown>, serviceAccount: GoogleServiceAccount) {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8FromPem(serviceAccount.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const header = { alg: "RS256", typ: "JWT" };
  const unsigned = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64Url(signature)}`;
}

async function googleSaveUrl(participant: ParticipantRow, token: string, companyName: string): Promise<{ saveUrl: string; objectId: string; payload: Record<string, unknown> } | null> {
  const issuerId = Deno.env.get("GOOGLE_WALLET_ISSUER_ID");
  const classSuffix = Deno.env.get("GOOGLE_WALLET_CLASS_ID");
  const serviceAccount = readGoogleServiceAccount();
  if (!issuerId || !classSuffix || !serviceAccount?.client_email || !serviceAccount.private_key) return null;

  const classId = walletId(issuerId, classSuffix);
  const objectId = `${issuerId}.arc2026_${participant.id.replaceAll("-", "_")}`;
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
  const ticketNumber = `ARC-2026-${participant.id.slice(0, 8).toUpperCase()}`;
  const textModulesData = [
    { header: "Dalībnieks", body: `${participant.first_name} ${participant.last_name}`.trim(), id: "participant" },
    ...(companyName ? [{ header: "Uzņēmums", body: companyName, id: "company" }] : []),
    { header: "E-pasts", body: participant.email, id: "email" },
  ];
  const payload = {
    iss: serviceAccount.client_email,
    aud: "google",
    typ: "savetowallet",
    iat: Math.floor(Date.now() / 1000),
    origins: [siteUrl],
    payload: {
      eventTicketObjects: [{
        id: objectId,
        classId,
        state: "ACTIVE",
        ticketHolderName: `${participant.first_name} ${participant.last_name}`.trim(),
        ticketNumber,
        barcode: {
          type: "QR_CODE",
          value: `${siteUrl}/checkin/?token=${token}`,
          alternateText: ticketNumber,
        },
        textModulesData,
      }],
    },
  };
  const jwt = await signGoogleJwt(payload, serviceAccount);
  return {
    objectId,
    payload,
    saveUrl: `https://pay.google.com/gp/v/save/${jwt}`,
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const url = new URL(request.url);
    const token = (url.searchParams.get("token") || "").trim();
    const provider = url.searchParams.get("provider") || "links";
    if (!token) return errorResponse("Token is required", 400);

    const db = new SupabaseRest();
    const participant = await resolveParticipant(db, token);
    if (!participant) return errorResponse("Participant not found", 404);
    const companyName = await resolveCompanyName(db, participant.company_id);

    if (provider === "apple") {
      const existing = (await db.select<WalletPassRow>("wallet_passes", {
        participant_id: `eq.${participant.id}`,
        provider: "eq.apple",
        limit: 1,
      }))[0];
      if (existing?.serial_number && existing.payload?.share_url) {
        await syncApplePassIfExists(db, participant.id, {
          attendeeName: `${participant.first_name} ${participant.last_name}`.trim(),
          companyName,
        });
        return applePassResponse(request, url, existing.payload.share_url);
      }

      const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
      const ticketId = `ARC-2026-${participant.id.slice(0, 8).toUpperCase()}`;
      const barcodeValue = `${siteUrl}/checkin/?token=${token}`;
      const passBody = buildApplePassBody({
        attendeeName: `${participant.first_name} ${participant.last_name}`.trim(),
        companyName,
        barcodeValue,
      });

      try {
        const created = await createApplePass(passBody);
        await db.upsert("wallet_passes", [{
          participant_id: participant.id,
          provider: "apple",
          serial_number: created.serialNumber,
          status: "created",
          payload: { share_url: created.shareUrl, barcode_value: barcodeValue },
        }], "participant_id,provider");
        return applePassResponse(request, url, created.shareUrl);
      } catch (error) {
        logPerkPassError({ participantId: participant.id, ticketId }, error);
        const status = error instanceof PerkPassApiError && error.status === 429 ? 429 : 502;
        return errorResponse(perkPassUserMessage(), status);
      }
    }

    if (provider === "google") {
      const google = await googleSaveUrl(participant, token, companyName);
      await db.upsert("wallet_passes", [{
        participant_id: participant.id,
        provider: "google",
        external_id: google?.objectId || participant.id,
        status: google ? "created" : "not_configured",
        payload: { save_url: google?.saveUrl || "", jwt_payload: google?.payload || null },
      }], "participant_id,provider");
      if (!google) {
        return jsonResponse({
          status: "not_configured",
          save_url: "",
          message: "Missing GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_CLASS_ID or GOOGLE_WALLET_SERVICE_ACCOUNT_JSON.",
        });
      }
      return Response.redirect(google.saveUrl, 302);
    }

    return jsonResponse({
      apple: `${url.origin}${url.pathname}?provider=apple&redirect=1&token=${encodeURIComponent(token)}`,
      google: `${url.origin}${url.pathname}?provider=google&token=${encodeURIComponent(token)}`,
    });
  } catch (error) {
    return errorResponse("Wallet failed", 500, String(error));
  }
});
