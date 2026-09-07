import { SupabaseRest } from "./supabase-rest.ts";

const WALLETWALLET_BASE_URL = "https://api.walletwallet.dev";
const WALLET_PROVIDER = "walletwallet";

export type WalletWalletField = {
  label: string;
  value: string;
  changeMessage?: string;
};

export type WalletWalletPassBody = {
  organizationName: string;
  logoText: string;
  barcodeValue: string;
  barcodeFormat: "QR";
  barcodeAltText: string;
  colorPreset: "dark";
  color: string;
  logoURL: string;
  iconURL: string;
  headerFields: WalletWalletField[];
  primaryFields: WalletWalletField[];
  secondaryFields: WalletWalletField[];
  backFields: WalletWalletField[];
  locations: { latitude: number; longitude: number; relevantText: string }[];
  sharingProhibited: true;
};

export type WalletWalletCreateResult = {
  serialNumber: string;
  shareUrl: string;
};

export class WalletWalletApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`WalletWallet API responded with ${status}`);
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = Deno.env.get("WALLETWALLET_API_KEY");
  if (!key) throw new Error("Missing env: WALLETWALLET_API_KEY");
  return key;
}

const LEGAL_FORM_ALIASES: Array<[string, string]> = [
  ["Pašvaldības sabiedrība ar ierobežotu atbildību", "PSIA"],
  ["Sabiedrība ar ierobežotu atbildību", "SIA"],
  ["Valsts akciju sabiedrība", "VAS"],
  ["Akciju sabiedrība", "AS"],
  ["Individuālais komersants", "IK"],
  ["Zemnieku saimniecība", "ZS"],
  ["Pilnsabiedrība", "PS"],
  ["Komandītsabiedrība", "KS"],
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converts a Latvian legal company name to the compact Wallet form: Name, SIA. */
export function formatWalletCompanyName(name: string, legalForm = ""): string {
  let compactName = name.trim();
  if (!compactName) return "";

  const normalizedLegalForm = legalForm.trim();
  let suffix = LEGAL_FORM_ALIASES.find(([full, short]) =>
    full.toLocaleLowerCase("lv-LV") === normalizedLegalForm.toLocaleLowerCase("lv-LV")
    || short.toLocaleLowerCase("lv-LV") === normalizedLegalForm.toLocaleLowerCase("lv-LV")
  )?.[1] || "";

  for (const [full, short] of LEGAL_FORM_ALIASES) {
    const formPattern = `${escapeRegExp(full)}|${escapeRegExp(short)}`;
    const prefix = new RegExp(`^(?:${formPattern})(?=\\s|[,.:–-]|[\"“”'«»])\\s*[,.:–-]?\\s*`, "i");
    const postfix = new RegExp(`(?:\\s*,\\s*|\\s+)(?:${formPattern})$`, "i");
    if (prefix.test(compactName) || postfix.test(compactName)) {
      suffix ||= short;
      compactName = compactName.replace(prefix, "").replace(postfix, "");
    }
  }

  compactName = compactName.trim().replace(/^["“”'«»]+|["“”'«»]+$/g, "").trim();
  return compactName && suffix ? `${compactName}, ${suffix}` : compactName;
}

/**
 * Static event details for AI Reality Check 2026 — only attendee name, company
 * and the check-in barcode value differ per participant.
 */
export function buildApplePassBody(params: {
  attendeeName: string;
  companyName: string;
  barcodeValue: string;
}): WalletWalletPassBody {
  const siteUrl = (Deno.env.get("PUBLIC_SITE_URL") || "https://konference.animas.lv").replace(/\/$/, "");
  return {
    organizationName: "ANIMAS",
    logoText: "AI Reality Check",
    barcodeValue: params.barcodeValue,
    barcodeFormat: "QR",
    barcodeAltText: "IEEJAS QR KODS",
    colorPreset: "dark",
    color: "#080808",
    logoURL: `${siteUrl}/apple-touch-icon.png`,
    iconURL: `${siteUrl}/apple-touch-icon.png`,
    headerFields: [
      { label: "DATUMS", value: "30. SEPT." },
    ],
    primaryFields: [
      { label: "DALĪBNIEKS", value: params.attendeeName },
    ],
    secondaryFields: [
      { label: "UZŅĒMUMS", value: formatWalletCompanyName(params.companyName) || "—" },
      { label: "VIETA", value: "Rīgas Motormuzejs" },
      { label: "LAIKS", value: "09.00–15.00" },
    ],
    backFields: [
      { label: "PASĀKUMS", value: "AI Reality Check 2026" },
      { label: "ADRESE", value: "Sergeja Eizenšteina iela 8, Rīga" },
      { label: "MĀJASLAPA", value: siteUrl },
      { label: "ATBALSTS", value: "konference@animas.lv" },
      {
        label: "NOTEIKUMI",
        value: "Biļete ir personīga un derīga tikai reģistrētajam dalībniekam. Nepārsūti QR kodu citām personām.",
      },
      { label: "Notifications", value: " ", changeMessage: "%@" },
    ],
    locations: [
      { latitude: 56.9719, longitude: 24.2436, relevantText: "AI Reality Check — Rīgas Motormuzejs" },
    ],
    sharingProhibited: true,
  };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

export async function createApplePass(body: WalletWalletPassBody): Promise<WalletWalletCreateResult> {
  const response = await fetch(`${WALLETWALLET_BASE_URL}/api/passes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseBody(response);
  if (!response.ok) throw new WalletWalletApiError(response.status, data);
  const result = data as { serialNumber?: string; shareUrl?: string };
  if (!result.serialNumber || !result.shareUrl) {
    throw new WalletWalletApiError(response.status, data);
  }
  return { serialNumber: result.serialNumber, shareUrl: result.shareUrl };
}

/** PUT expects the full current pass body — never include serialNumber or authenticationToken. */
export async function updateApplePass(serialNumber: string, body: WalletWalletPassBody): Promise<void> {
  const response = await fetch(`${WALLETWALLET_BASE_URL}/api/passes/${encodeURIComponent(serialNumber)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new WalletWalletApiError(response.status, await parseBody(response));
}

const USER_FACING_ERROR = "Apple Wallet biļeti pašlaik neizdevās izveidot. Lūdzu, mēģiniet vēlreiz.";

export function logWalletWalletError(context: { participantId: string; ticketId: string }, error: unknown): void {
  if (error instanceof WalletWalletApiError) {
    console.error("WalletWallet API error", {
      status: error.status,
      body: error.body,
      participant_id: context.participantId,
      ticket_id: context.ticketId,
    });
    return;
  }
  console.error("WalletWallet request failed", {
    message: error instanceof Error ? error.message : String(error),
    participant_id: context.participantId,
    ticket_id: context.ticketId,
  });
}

export function walletWalletUserMessage(): string {
  return USER_FACING_ERROR;
}

type WalletPassRow = {
  serial_number: string | null;
  payload: { barcode_value?: string; wallet_provider?: string } | null;
};

/**
 * Keeps an already-issued Apple pass in sync when attendee/company data
 * changes. No-op if the participant never requested an Apple pass yet — the
 * next `wallet?provider=apple` call will create one on demand. The original
 * barcodeValue (check-in identifier) is reused as-is — callers only supply
 * the fields that are allowed to change, so the QR code a participant already
 * scanned or bookmarked never shifts under them. Failures are logged, not
 * thrown, so this can be called from flows (e.g. approval) that must not
 * break because of a WalletWallet hiccup. Legacy passes from the previous
 * provider are skipped and replaced on the participant's next wallet request.
 */
export async function syncApplePassIfExists(
  db: SupabaseRest,
  participantId: string,
  fields: { attendeeName: string; companyName: string },
): Promise<void> {
  const existing = (await db.select<WalletPassRow>("wallet_passes", {
    participant_id: `eq.${participantId}`,
    provider: "eq.apple",
    limit: 1,
  }))[0];
  const barcodeValue = existing?.payload?.barcode_value;
  if (existing?.payload?.wallet_provider !== WALLET_PROVIDER || !existing.serial_number || !barcodeValue) return;

  try {
    await updateApplePass(existing.serial_number, buildApplePassBody({ ...fields, barcodeValue }));
    await db.update("wallet_passes", { updated_at: new Date().toISOString() }, {
      participant_id: `eq.${participantId}`,
      provider: "eq.apple",
    });
  } catch (error) {
    logWalletWalletError({ participantId, ticketId: existing.serial_number }, error);
  }
}
