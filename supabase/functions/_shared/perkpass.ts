import { SupabaseRest } from "./supabase-rest.ts";

const PERKPASS_BASE_URL = "https://perkpass.co.uk";

export type PerkPassField = {
  key: string;
  label: string;
  value: string;
  changeMessage?: string;
};

export type PerkPassBody = {
  passStyle: "eventTicket";
  organizationName: string;
  logoText: string;
  description: string;
  barcodeValue: string;
  barcodeFormat: "QR";
  headerFields: PerkPassField[];
  primaryFields: PerkPassField[];
  secondaryFields: PerkPassField[];
  backFields: PerkPassField[];
  expirationDate: string;
  locations: { latitude: number; longitude: number; relevantText: string }[];
  sharingProhibited: true;
};

export type PerkPassCreateResult = {
  serialNumber: string;
  shareUrl: string;
};

export class PerkPassApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`PerkPass API responded with ${status}`);
    this.status = status;
    this.body = body;
  }
}

function apiKey(): string {
  const key = Deno.env.get("PERKPASS_API_KEY");
  if (!key) throw new Error("Missing env: PERKPASS_API_KEY");
  return key;
}

/**
 * Static event details for AI Reality Check 2026 — only attendee name, company
 * and the check-in barcode value differ per participant.
 */
export function buildApplePassBody(params: {
  attendeeName: string;
  companyName: string;
  barcodeValue: string;
}): PerkPassBody {
  return {
    passStyle: "eventTicket",
    organizationName: "Animas",
    logoText: "AI Reality Check",
    description: "AI Reality Check 2026 Conference Ticket",
    barcodeValue: params.barcodeValue,
    barcodeFormat: "QR",
    headerFields: [
      { key: "date", label: "DATE", value: "30 SEPT" },
    ],
    primaryFields: [
      { key: "attendee", label: "ATTENDEE", value: params.attendeeName },
    ],
    secondaryFields: [
      { key: "company", label: "COMPANY", value: params.companyName || "—" },
      { key: "location", label: "LOCATION", value: "Rīgas Motormuzejs" },
      { key: "time", label: "TIME", value: "09:00" },
    ],
    backFields: [
      { key: "website", label: "Website", value: "https://airealitycheck.lv" },
      { key: "support", label: "Support", value: "konference@animas.lv" },
      { key: "terms", label: "Terms", value: "Valid only for the registered attendee." },
    ],
    expirationDate: "2026-09-30T18:00:00+03:00",
    locations: [
      { latitude: 56.9719, longitude: 24.2436, relevantText: "AI Reality Check at Rīgas Motormuzejs" },
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

export async function createApplePass(body: PerkPassBody): Promise<PerkPassCreateResult> {
  const response = await fetch(`${PERKPASS_BASE_URL}/api/passes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await parseBody(response);
  if (!response.ok) throw new PerkPassApiError(response.status, data);
  const result = data as { serialNumber?: string; shareUrl?: string };
  if (!result.serialNumber || !result.shareUrl) {
    throw new PerkPassApiError(response.status, data);
  }
  return { serialNumber: result.serialNumber, shareUrl: result.shareUrl };
}

/** PUT expects the full current pass body — never include serialNumber or authenticationToken. */
export async function updateApplePass(serialNumber: string, body: PerkPassBody): Promise<void> {
  const response = await fetch(`${PERKPASS_BASE_URL}/api/passes/${encodeURIComponent(serialNumber)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new PerkPassApiError(response.status, await parseBody(response));
}

const USER_FACING_ERROR = "Apple Wallet biļeti pašlaik neizdevās izveidot. Lūdzu, mēģiniet vēlreiz.";

export function logPerkPassError(context: { participantId: string; ticketId: string }, error: unknown): void {
  if (error instanceof PerkPassApiError) {
    console.error("PerkPass API error", {
      status: error.status,
      body: error.body,
      participant_id: context.participantId,
      ticket_id: context.ticketId,
    });
    return;
  }
  console.error("PerkPass request failed", {
    message: error instanceof Error ? error.message : String(error),
    participant_id: context.participantId,
    ticket_id: context.ticketId,
  });
}

export function perkPassUserMessage(): string {
  return USER_FACING_ERROR;
}

type WalletPassRow = {
  serial_number: string | null;
  payload: { barcode_value?: string } | null;
};

/**
 * Keeps an already-issued Apple pass in sync when attendee/company data
 * changes. No-op if the participant never requested an Apple pass yet — the
 * next `wallet?provider=apple` call will create one on demand. The original
 * barcodeValue (check-in identifier) is reused as-is — callers only supply
 * the fields that are allowed to change, so the QR code a participant already
 * scanned or bookmarked never shifts under them. Failures are logged, not
 * thrown, so this can be called from flows (e.g. approval) that must not
 * break because of a PerkPass hiccup.
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
  if (!existing?.serial_number || !barcodeValue) return;

  try {
    await updateApplePass(existing.serial_number, buildApplePassBody({ ...fields, barcodeValue }));
    await db.update("wallet_passes", { updated_at: new Date().toISOString() }, {
      participant_id: `eq.${participantId}`,
      provider: "eq.apple",
    });
  } catch (error) {
    logPerkPassError({ participantId, ticketId: existing.serial_number }, error);
  }
}
