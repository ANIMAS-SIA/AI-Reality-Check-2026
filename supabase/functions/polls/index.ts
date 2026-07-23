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
  allow_anonymous: boolean;
  results_public: boolean;
};
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string };
type VotePayload = {
  pollId?: string;
  optionId?: string;
  participantId?: string;
  anonymousSessionId?: string;
  isAnonymous?: boolean;
};

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
  const active = polls.find((poll) => poll.status === "active") || null;
  const published = polls.filter((poll) => poll.results_public || ["published", "closed"].includes(poll.status));
  const activeResult = active ? await resultsForPoll(db, active) : null;
  const resultSets = [];
  for (const poll of published) resultSets.push(await resultsForPoll(db, poll));
  return jsonResponse({ active: activeResult, results: resultSets, polls });
}

async function submitVote(db: SupabaseRest, payload: VotePayload): Promise<Response> {
  const pollId = clean(payload.pollId);
  const optionId = clean(payload.optionId);
  if (!pollId || !optionId) return errorResponse("Poll and option are required", 400);

  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);
  if (poll.status !== "active") return errorResponse("Poll is not active", 409);

  const participantId = clean(payload.participantId);
  const anonymousSessionId = clean(payload.anonymousSessionId) || crypto.randomUUID();

  try {
    await db.insert("poll_votes", [{
      poll_id: pollId,
      option_id: optionId,
      participant_id: participantId || null,
      anonymous_session_id: participantId ? null : anonymousSessionId,
      is_anonymous: payload.isAnonymous !== false,
    }]);
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
