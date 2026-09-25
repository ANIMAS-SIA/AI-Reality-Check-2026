import { broadcast } from "../_shared/broadcast.ts";
import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { hashToken } from "../_shared/tokens.ts";

type EventRow = { id: string; slug: string };
type PollRow = {
  id: string;
  event_id: string;
  agenda_item_id: string | null;
  title: string;
  status: string;
  poll_type: string;
  allow_anonymous: boolean;
  results_public: boolean;
  settings: { allowMultipleSubmissions?: boolean } | null;
};
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string };
type TextResponseRow = { id: string; poll_id: string; response_text: string; created_at: string };
type TokenRow = { participant_id: string; expires_at: string | null };
type VoterIdentity = { participantId: string; anonymousSessionId: string };
type VotePayload = {
  pollId?: string;
  optionId?: string;
  optionIds?: string[];
  responseText?: string;
  token?: string;
  anonymousSessionId?: string;
  isAnonymous?: boolean;
};

const TEXT_POLL_TYPES = ["open_text", "word_cloud"];

function clean(value?: string | null): string {
  return (value || "").trim();
}

function allowsMultipleSubmissions(poll: PollRow): boolean {
  if (typeof poll.settings?.allowMultipleSubmissions === "boolean") return poll.settings.allowMultipleSubmissions;
  return TEXT_POLL_TYPES.includes(poll.poll_type);
}

async function voterIdentity(db: SupabaseRest, token?: string | null, anonymousSessionId?: string | null): Promise<VoterIdentity | null> {
  const cleanToken = clean(token);
  if (cleanToken) {
    const tokenHash = await hashToken(cleanToken, requiredEnv("TOKEN_PEPPER"));
    const tokenRow = (await db.select<TokenRow>("participant_tokens", {
      token_hash: `eq.${tokenHash}`,
      purpose: "eq.magic_link",
      revoked_at: "is.null",
      limit: 1,
    }))[0];
    if (!tokenRow || (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now())) return null;
    return { participantId: tokenRow.participant_id, anonymousSessionId: "" };
  }
  const sessionId = clean(anonymousSessionId);
  return sessionId ? { participantId: "", anonymousSessionId: sessionId } : null;
}

async function submittedPollIds(db: SupabaseRest, identity: VoterIdentity | null): Promise<Set<string>> {
  if (!identity) return new Set();
  const rows = await db.select<{ poll_id: string }>("poll_submission_guards", identity.participantId
    ? { participant_id: `eq.${identity.participantId}`, select: "poll_id" }
    : { anonymous_session_id: `eq.${identity.anonymousSessionId}`, select: "poll_id" });
  return new Set(rows.map((row) => row.poll_id));
}

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = db.eventSlug;
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function resultsForPoll(db: SupabaseRest, poll: PollRow, submitted = false) {
  if (TEXT_POLL_TYPES.includes(poll.poll_type)) {
    const responses = await db.select<TextResponseRow>("poll_text_responses", {
      poll_id: `eq.${poll.id}`,
      hidden: "eq.false",
      order: "created_at.desc",
      limit: 300,
    });
    return {
      poll,
      options: [],
      text_responses: responses.map((row) => row.response_text),
      total_votes: responses.length,
      has_submitted: submitted,
    };
  }

  const options = await db.select<PollOptionRow>("poll_options", {
    poll_id: `eq.${poll.id}`,
    order: "display_order.asc",
  });
  const votes = await db.select<PollVoteRow>("poll_votes", { poll_id: `eq.${poll.id}` });
  const total = votes.length;
  return {
    poll,
    options: options.map((option) => {
      const count = votes.filter((vote) => vote.option_id === option.id).length;
      return {
        ...option,
        votes: count,
        percent: total ? Math.round((count / total) * 100) : 0,
      };
    }),
    total_votes: total,
    has_submitted: submitted,
  };
}

async function listPolls(db: SupabaseRest, eventId: string, identity: VoterIdentity | null): Promise<Response> {
  const polls = await db.select<PollRow>("polls", {
    event_id: `eq.${eventId}`,
    order: "created_at.asc",
  });
  const activePolls = polls.filter((poll) => poll.status === "active");
  const published = polls.filter((poll) => poll.status !== "archived"
    && (poll.results_public || ["published", "closed"].includes(poll.status)));
  const submitted = await submittedPollIds(db, identity);
  const activeResults = [];
  for (const poll of activePolls) activeResults.push(await resultsForPoll(db, poll, submitted.has(poll.id)));
  const resultSets = [];
  for (const poll of published) resultSets.push(await resultsForPoll(db, poll, submitted.has(poll.id)));
  return jsonResponse({ active: activeResults[0] || null, activePolls: activeResults, results: resultSets, polls });
}

async function claimSingleSubmission(db: SupabaseRest, pollId: string, identity: VoterIdentity): Promise<string | null> {
  try {
    const guard = (await db.insert<{ id: string }>("poll_submission_guards", [{
      poll_id: pollId,
      participant_id: identity.participantId || null,
      anonymous_session_id: identity.participantId ? null : identity.anonymousSessionId,
    }]))[0];
    return guard.id;
  } catch {
    return null;
  }
}

async function releaseClaim(db: SupabaseRest, guardId: string): Promise<void> {
  if (!guardId) return;
  await db.delete("poll_submission_guards", { id: `eq.${guardId}` }).catch(() => undefined);
}

async function submitVote(db: SupabaseRest, payload: VotePayload): Promise<Response> {
  const pollId = clean(payload.pollId);
  if (!pollId) return errorResponse("Poll is required", 400);

  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);
  if (poll.status !== "active") return errorResponse("Poll is not active", 409);

  const identity = await voterIdentity(db, payload.token, payload.anonymousSessionId);
  if (!identity) return errorResponse("Dalībnieka sesija nav derīga", 401);
  const multipleSubmissions = allowsMultipleSubmissions(poll);
  const guardId = multipleSubmissions ? "" : (await claimSingleSubmission(db, pollId, identity) || "");
  if (!multipleSubmissions && !guardId) {
    return errorResponse("Šajā balsojumā atbildi var iesniegt tikai vienu reizi.", 409);
  }

  const participantId = multipleSubmissions ? "" : identity.participantId;
  const anonymousSessionId = multipleSubmissions
    ? `${identity.anonymousSessionId || identity.participantId}:${crypto.randomUUID()}`
    : identity.anonymousSessionId;

  if (TEXT_POLL_TYPES.includes(poll.poll_type)) {
    const responseText = clean(payload.responseText);
    if (!responseText) {
      await releaseClaim(db, guardId);
      return errorResponse("Response text is required", 400);
    }
    if (responseText.length > 280) {
      await releaseClaim(db, guardId);
      return errorResponse("Response is too long", 422);
    }
    try {
      await db.insert("poll_text_responses", [{
        poll_id: pollId,
        participant_id: participantId || null,
        anonymous_session_id: participantId ? null : anonymousSessionId,
        response_text: responseText,
      }]);
    } catch (error) {
      await releaseClaim(db, guardId);
      return errorResponse("Atbildi neizdevās saglabāt.", 500, String(error));
    }
    await broadcast(db.topic, "poll_voted", { poll_id: pollId });
    return jsonResponse({ ok: true, anonymousSessionId: identity.anonymousSessionId, results: await resultsForPoll(db, poll, !multipleSubmissions) });
  }

  const optionIds = poll.poll_type === "multiple_choice"
    ? [...new Set((payload.optionIds || []).map(clean).filter(Boolean))]
    : [clean(payload.optionId)].filter(Boolean);
  if (!optionIds.length) {
    await releaseClaim(db, guardId);
    return errorResponse("At least one option is required", 400);
  }

  try {
    await db.insert("poll_votes", optionIds.map((optionId) => ({
      poll_id: pollId,
      option_id: optionId,
      participant_id: participantId || null,
      anonymous_session_id: participantId ? null : anonymousSessionId,
      is_anonymous: payload.isAnonymous !== false,
    })));
  } catch (error) {
    await releaseClaim(db, guardId);
    return errorResponse("Balsojumu neizdevās saglabāt.", 500, String(error));
  }

  await broadcast(db.topic, "poll_voted", { poll_id: pollId });
  return jsonResponse({ ok: true, anonymousSessionId: identity.anonymousSessionId, results: await resultsForPoll(db, poll, !multipleSubmissions) });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest(request);
    await db.assertRehearsalSafe(request);
    const event = await getEvent(db);

    if (request.method === "GET") {
      const url = new URL(request.url);
      const identity = await voterIdentity(db, request.headers.get("x-participant-token"), url.searchParams.get("anonymous_session_id"));
      return await listPolls(db, event.id, identity);
    }
    if (request.method === "POST") {
      const limited = await rateLimit(db, request, "polls", 30, 60);
      if (limited) return limited;
      return await submitVote(db, await readJson<VotePayload>(request));
    }
    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Polls failed", 500, String(error));
  }
});
