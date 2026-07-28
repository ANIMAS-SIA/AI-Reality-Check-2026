import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { hashToken } from "../_shared/tokens.ts";

type ParticipantRow = {
  id: string;
  event_id: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string | null;
  company_id: string | null;
  networking_allowed: boolean;
};
type CompanyRow = { id: string; name: string };
type ProfileRow = {
  participant_id: string;
  is_visible: boolean;
  wants_to_discuss: string | null;
  can_offer: string | null;
  looking_for: string | null;
  accepts_contact_requests: boolean;
};
type ContactRow = {
  id: string;
  event_id: string;
  requester_id: string;
  recipient_id: string;
  message: string | null;
  status: string;
  created_at: string;
};

async function currentParticipant(db: SupabaseRest, token: string): Promise<ParticipantRow | null> {
  if (!token) return null;
  const tokenHash = await hashToken(token, requiredEnv("TOKEN_PEPPER"));
  const tokenRows = await db.select<{ participant_id: string }>("participant_tokens", {
    token_hash: `eq.${tokenHash}`,
    purpose: "eq.magic_link",
    revoked_at: "is.null",
    limit: 1,
  });
  const participantId = tokenRows[0]?.participant_id;
  if (!participantId) return null;
  return (await db.select<ParticipantRow>("participants", { id: `eq.${participantId}`, limit: 1 }))[0] || null;
}

function publicParticipant(participant: ParticipantRow, profile: ProfileRow, company?: CompanyRow, revealEmail = false) {
  return {
    id: participant.id,
    name: `${participant.first_name} ${participant.last_name}`.trim(),
    role: participant.role || "",
    company: company?.name || "",
    email: revealEmail ? participant.email : undefined,
    wants_to_discuss: profile.wants_to_discuss || "",
    can_offer: profile.can_offer || "",
    looking_for: profile.looking_for || "",
    accepts_contact_requests: profile.accepts_contact_requests,
  };
}

async function listNetworking(db: SupabaseRest, participant: ParticipantRow): Promise<Response> {
  const profiles = await db.select<ProfileRow>("networking_profiles", {
    is_visible: "eq.true",
    order: "updated_at.desc",
    limit: 200,
  });
  const participantIds = profiles.map((profile) => profile.participant_id);
  const participants: ParticipantRow[] = [];
  for (const id of participantIds) {
    const row = (await db.select<ParticipantRow>("participants", { id: `eq.${id}`, limit: 1 }))[0];
    if (row) participants.push(row);
  }
  const companyIds = [...new Set(participants.map((row) => row.company_id).filter(Boolean))] as string[];
  const companies = new Map<string, CompanyRow>();
  for (const id of companyIds) {
    const row = (await db.select<CompanyRow>("companies", { id: `eq.${id}`, limit: 1 }))[0];
    if (row) companies.set(id, row);
  }
  const requests = await db.select<ContactRow>("contact_requests", {
    event_id: `eq.${participant.event_id}`,
    order: "created_at.desc",
    limit: 200,
  });
  const acceptedPairs = new Set(requests.filter((row) => row.status === "accepted").map((row) => [row.requester_id, row.recipient_id].sort().join(":")));
  const ownProfile = (await db.select<ProfileRow>("networking_profiles", { participant_id: `eq.${participant.id}`, limit: 1 }))[0] || null;
  return jsonResponse({
    participant: { id: participant.id, name: `${participant.first_name} ${participant.last_name}`.trim(), email: participant.email },
    profile: ownProfile,
    profiles: profiles
      .map((profile) => {
        const owner = participants.find((row) => row.id === profile.participant_id);
        if (!owner || owner.id === participant.id) return null;
        const pair = [owner.id, participant.id].sort().join(":");
        return publicParticipant(owner, profile, owner.company_id ? companies.get(owner.company_id) : undefined, acceptedPairs.has(pair));
      })
      .filter(Boolean),
    requests: requests.filter((row) => row.requester_id === participant.id || row.recipient_id === participant.id),
  });
}

async function saveProfile(db: SupabaseRest, participant: ParticipantRow, payload: Record<string, unknown>): Promise<Response> {
  const visible = Boolean(payload.isVisible);
  await db.update("participants", { networking_allowed: visible }, { id: `eq.${participant.id}` });
  const rows = await db.upsert<ProfileRow>("networking_profiles", [{
    participant_id: participant.id,
    is_visible: visible,
    wants_to_discuss: String(payload.wantsToDiscuss || "").trim() || null,
    can_offer: String(payload.canOffer || "").trim() || null,
    looking_for: String(payload.lookingFor || "").trim() || null,
    accepts_contact_requests: payload.acceptsContactRequests !== false,
  }], "participant_id");
  return jsonResponse({ profile: rows[0] });
}

async function requestContact(db: SupabaseRest, participant: ParticipantRow, payload: Record<string, unknown>): Promise<Response> {
  const recipientId = String(payload.recipientId || "").trim();
  if (!recipientId || recipientId === participant.id) return errorResponse("Recipient is required", 400);
  const recipientProfile = (await db.select<ProfileRow>("networking_profiles", {
    participant_id: `eq.${recipientId}`,
    is_visible: "eq.true",
    accepts_contact_requests: "eq.true",
    limit: 1,
  }))[0];
  if (!recipientProfile) return errorResponse("Recipient is not available for networking", 404);
  const rows = await db.upsert<ContactRow>("contact_requests", [{
    event_id: participant.event_id,
    requester_id: participant.id,
    recipient_id: recipientId,
    message: String(payload.message || "").trim() || null,
    status: "pending",
  }], "requester_id,recipient_id");
  return jsonResponse({ request: rows[0] }, 201);
}

async function respondContact(db: SupabaseRest, participant: ParticipantRow, requestId: string, status: string): Promise<Response> {
  if (!["accepted", "declined"].includes(status)) return errorResponse("Unsupported status", 400);
  const existing = (await db.select<ContactRow>("contact_requests", {
    id: `eq.${requestId}`,
    recipient_id: `eq.${participant.id}`,
    limit: 1,
  }))[0];
  if (!existing) return errorResponse("Request not found", 404);
  const rows = await db.update<ContactRow>("contact_requests", { status }, { id: `eq.${requestId}` });
  return jsonResponse({ request: rows[0] });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const url = new URL(request.url);
    const participant = await currentParticipant(db, url.searchParams.get("token") || "");
    if (!participant) return errorResponse("Invalid token", 401);

    if (request.method === "GET") return await listNetworking(db, participant);
    if (request.method === "POST") {
      const action = url.searchParams.get("action") || "profile";
      const payload = await readJson<Record<string, unknown>>(request);
      if (action === "profile") return await saveProfile(db, participant, payload);
      if (action === "request") return await requestContact(db, participant, payload);
      if (action === "respond") return await respondContact(db, participant, String(payload.requestId || ""), String(payload.status || ""));
      return errorResponse("Unsupported networking action", 400);
    }
    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Networking failed", 500, String(error));
  }
});
