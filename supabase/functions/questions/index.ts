import { broadcast } from "../_shared/broadcast.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type QuestionPayload = {
  agendaItemId?: string;
  body?: string;
  isAnonymous?: boolean;
  participantId?: string;
  anonymousSessionId?: string;
};

type VotePayload = {
  questionId?: string;
  participantId?: string;
  anonymousSessionId?: string;
};

type EventRow = { id: string; slug: string; current_agenda_item_id: string | null };
type AgendaRow = { id: string; title: string; speaker_name: string | null };
type QuestionRow = {
  id: string;
  event_id: string;
  agenda_item_id: string | null;
  participant_id: string | null;
  anonymous_session_id: string | null;
  body: string;
  is_anonymous: boolean;
  status: string;
  vote_count: number;
  created_at: string;
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

async function listQuestions(db: SupabaseRest, eventId: string, agendaItemId?: string | null): Promise<Response> {
  const query: Record<string, string | number> = {
    event_id: `eq.${eventId}`,
    status: "in.(approved,answered)",
    order: "vote_count.desc,created_at.desc",
    limit: 80,
  };
  if (agendaItemId) query.agenda_item_id = `eq.${agendaItemId}`;
  const questions = await db.select<QuestionRow>("questions", query);
  return jsonResponse({ questions });
}

async function createQuestion(db: SupabaseRest, event: EventRow, payload: QuestionPayload): Promise<Response> {
  const body = clean(payload.body);
  if (!body || body.length > 280) return errorResponse("Jautājumam jābūt 1-280 rakstzīmēm.", 400);

  const anonymousSessionId = clean(payload.anonymousSessionId) || crypto.randomUUID();
  const agendaItemId = clean(payload.agendaItemId) || event.current_agenda_item_id;
  const participantId = clean(payload.participantId);
  const isAnonymous = payload.isAnonymous !== false || !participantId;
  const inserted = await db.insert<QuestionRow>("questions", [{
    event_id: event.id,
    agenda_item_id: agendaItemId,
    participant_id: isAnonymous ? null : participantId,
    anonymous_session_id: isAnonymous ? anonymousSessionId : null,
    body,
    is_anonymous: isAnonymous,
    status: "pending",
  }]);
  const question = inserted[0];
  await broadcast("live:ai-reality-check-2026", "question_created", { question_id: question.id });
  return jsonResponse({ question, anonymousSessionId }, 201);
}

async function voteQuestion(db: SupabaseRest, payload: VotePayload): Promise<Response> {
  const questionId = clean(payload.questionId);
  if (!questionId) return errorResponse("Question ID is required", 400);
  const participantId = clean(payload.participantId);
  const anonymousSessionId = clean(payload.anonymousSessionId) || crypto.randomUUID();

  try {
    await db.insert("question_votes", [{
      question_id: questionId,
      participant_id: participantId || null,
      anonymous_session_id: participantId ? null : anonymousSessionId,
    }]);
  } catch (error) {
    return errorResponse("Balsojums jau ir iesniegts.", 409, String(error));
  }

  await broadcast("live:ai-reality-check-2026", "question_voted", { question_id: questionId });
  return jsonResponse({ ok: true, anonymousSessionId });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const event = await getEvent(db);
    const url = new URL(request.url);

    if (request.method === "GET") {
      return await listQuestions(db, event.id, url.searchParams.get("agenda_item_id"));
    }

    if (request.method === "POST") {
      const limited = await rateLimit(db, request, "questions", 20, 60);
      if (limited) return limited;
      const action = url.searchParams.get("action") || "create";
      if (action === "vote") return await voteQuestion(db, await readJson<VotePayload>(request));
      return await createQuestion(db, event, await readJson<QuestionPayload>(request));
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Questions failed", 500, String(error));
  }
});
