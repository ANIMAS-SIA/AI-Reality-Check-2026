import { broadcast } from "../_shared/broadcast.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

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
  settings: Record<string, unknown>;
};
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string };
type TextResponseRow = { id: string; poll_id: string; response_text: string; created_at: string };
type VotePayload = {
  pollId?: string;
  optionId?: string;
  optionIds?: string[];
  responseText?: string;
  participantId?: string;
  anonymousSessionId?: string;
  isAnonymous?: boolean;
};

const TEXT_POLL_TYPES = ["open_text", "word_cloud"];

function clean(value?: string): string {
  return (value || "").trim();
}

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function resultsForPoll(db: SupabaseRest, poll: PollRow) {
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
  };
}

async function listPolls(db: SupabaseRest, eventId: string): Promise<Response> {
  const polls = await db.select<PollRow>("polls", {
    event_id: `eq.${eventId}`,
    order: "created_at.asc",
  });
  const activePolls = polls.filter((poll) => poll.status === "active");
  const published = polls.filter((poll) => poll.results_public || poll.settings?.resultsVisibleLive === true || ["published", "closed"].includes(poll.status));
  const activeResults = [];
  for (const poll of activePolls) activeResults.push(await resultsForPoll(db, poll));
  const resultSets = [];
  for (const poll of published) resultSets.push(await resultsForPoll(db, poll));
  return jsonResponse({ active: activeResults[0] || null, activePolls: activeResults, results: resultSets, polls });
}

async function submitVote(db: SupabaseRest, payload: VotePayload): Promise<Response> {
  const pollId = clean(payload.pollId);
  if (!pollId) return errorResponse("Poll is required", 400);

  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);
  if (poll.status !== "active") return errorResponse("Poll is not active", 409);

  const participantId = clean(payload.participantId);
  const anonymousSessionId = clean(payload.anonymousSessionId) || crypto.randomUUID();

  if (TEXT_POLL_TYPES.includes(poll.poll_type)) {
    const responseText = clean(payload.responseText);
    if (!responseText) return errorResponse("Response text is required", 400);
    if (responseText.length > 280) return errorResponse("Response is too long", 422);
    await db.insert("poll_text_responses", [{
      poll_id: pollId,
      participant_id: participantId || null,
      anonymous_session_id: participantId ? null : anonymousSessionId,
      response_text: responseText,
    }]);
    await broadcast("live:ai-reality-check-2026", "poll_voted", { poll_id: pollId });
    return jsonResponse({ ok: true, anonymousSessionId, results: await resultsForPoll(db, poll) });
  }

  const optionIds = poll.poll_type === "multiple_choice"
    ? (payload.optionIds || []).map(clean).filter(Boolean)
    : [clean(payload.optionId)].filter(Boolean);
  if (!optionIds.length) return errorResponse("At least one option is required", 400);
  const uniqueOptionIds = [...new Set(optionIds)];
  if (poll.poll_type !== "multiple_choice" && uniqueOptionIds.length !== 1) {
    return errorResponse("Exactly one option is required", 422);
  }
  const validOptions = await db.select<PollOptionRow>("poll_options", { poll_id: `eq.${pollId}` });
  const validOptionIds = new Set(validOptions.map((option) => option.id));
  if (uniqueOptionIds.some((optionId) => !validOptionIds.has(optionId))) {
    return errorResponse("Invalid option for this poll", 422);
  }

  try {
    await db.insert("poll_votes", uniqueOptionIds.map((optionId) => ({
      poll_id: pollId,
      option_id: optionId,
      participant_id: participantId || null,
      anonymous_session_id: participantId ? null : anonymousSessionId,
      is_anonymous: payload.isAnonymous !== false,
    })));
  } catch (error) {
    return errorResponse("Šajā balsojumā balss jau ir iesniegta.", 409, String(error));
  }

  await broadcast("live:ai-reality-check-2026", "poll_voted", { poll_id: pollId });
  return jsonResponse({ ok: true, anonymousSessionId, results: await resultsForPoll(db, poll) });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const event = await getEvent(db);

    if (request.method === "GET") return await listPolls(db, event.id);
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
