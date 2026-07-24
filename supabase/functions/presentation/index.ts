import { broadcast } from "../_shared/broadcast.ts";
import { AdminActor, AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

const TOPIC = "live:ai-reality-check-2026";
const MODES = ["waiting", "agenda", "poll_question", "poll_results", "questions", "announcement", "results", "closing"] as const;
type Mode = typeof MODES[number];

type EventRow = { id: string; slug: string; name: string };
type StateRow = {
  id: string;
  event_id: string;
  mode: Mode;
  agenda_item_id: string | null;
  poll_id: string | null;
  question_id: string | null;
  results_visible: boolean;
  qr_visible: boolean;
  announcement_text: string | null;
  updated_at: string;
};
type AgendaItem = {
  id: string;
  title: string;
  description: string | null;
  speaker_name: string | null;
  speaker_role: string | null;
  speaker_company: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  is_break: boolean;
};
type PollRow = { id: string; title: string; poll_type: string; status: string; agenda_item_id: string | null };
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string };
type TextResponseRow = { id: string; poll_id: string; response_text: string };
type QuestionRow = { id: string; body: string; is_anonymous: boolean; vote_count: number; agenda_item_id: string | null };
type ParticipantRow = { id: string };

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function ensureState(db: SupabaseRest, event: EventRow): Promise<StateRow> {
  const existing = (await db.select<StateRow>("presentation_state", { event_id: `eq.${event.id}`, limit: 1 }))[0];
  if (existing) return existing;
  const created = await db.insert<StateRow>("presentation_state", [{ event_id: event.id, mode: "waiting" }]);
  return created[0];
}

async function pollSnapshot(db: SupabaseRest, pollId: string) {
  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return null;
  if (poll.poll_type === "open_text" || poll.poll_type === "word_cloud") {
    const responses = await db.select<TextResponseRow>("poll_text_responses", {
      poll_id: `eq.${pollId}`,
      hidden: "eq.false",
      order: "created_at.desc",
      limit: 200,
    });
    return { poll, options: [], text_responses: responses.map((row) => row.response_text), total_votes: responses.length };
  }
  const options = await db.select<PollOptionRow>("poll_options", { poll_id: `eq.${pollId}`, order: "display_order.asc" });
  const votes = await db.select<PollVoteRow>("poll_votes", { poll_id: `eq.${pollId}` });
  const total = votes.length;
  return {
    poll,
    options: options.map((option) => {
      const count = votes.filter((vote) => vote.option_id === option.id).length;
      return { ...option, votes: count, percent: total ? Math.round((count / total) * 100) : 0 };
    }),
    total_votes: total,
  };
}

async function buildSnapshot(db: SupabaseRest, event: EventRow, state: StateRow) {
  const [agendaItem, poll, question] = await Promise.all([
    state.agenda_item_id
      ? (await db.select<AgendaItem>("agenda_items", { id: `eq.${state.agenda_item_id}`, limit: 1 }))[0] || null
      : null,
    state.poll_id ? pollSnapshot(db, state.poll_id) : null,
    state.question_id
      ? (await db.select<QuestionRow>("questions", { id: `eq.${state.question_id}`, limit: 1 }))[0] || null
      : null,
  ]);

  let topQuestions: QuestionRow[] = [];
  if (state.mode === "questions" && !question) {
    topQuestions = await db.select<QuestionRow>("questions", {
      event_id: `eq.${event.id}`,
      status: "in.(approved,highlighted,shown_on_screen)",
      order: "vote_count.desc,created_at.desc",
      limit: 5,
    });
  }

  let summary: Record<string, unknown> | null = null;
  if (state.mode === "results") {
    const participants = await db.select<ParticipantRow>("participants", {
      event_id: `eq.${event.id}`,
      status: "in.(approved,arrived)",
      select: "id",
    });
    summary = { event_name: event.name, participant_count: participants.length };
  }

  return {
    state: {
      mode: state.mode,
      results_visible: state.results_visible,
      qr_visible: state.qr_visible,
      announcement_text: state.announcement_text,
      updated_at: state.updated_at,
    },
    agenda_item: agendaItem,
    poll,
    question,
    top_questions: topQuestions,
    summary,
  };
}

async function getSnapshot(db: SupabaseRest): Promise<Response> {
  const event = await getEvent(db);
  const state = await ensureState(db, event);
  return jsonResponse(await buildSnapshot(db, event, state));
}

type UpdatePayload = Partial<{
  mode: Mode;
  agendaItemId: string | null;
  pollId: string | null;
  questionId: string | null;
  resultsVisible: boolean;
  qrVisible: boolean;
  announcementText: string | null;
}>;

async function updateState(db: SupabaseRest, actor: AdminActor, payload: UpdatePayload): Promise<Response> {
  const event = await getEvent(db);
  const state = await ensureState(db, event);

  const row: Record<string, unknown> = { updated_by: actor.userId, updated_at: new Date().toISOString() };
  if (payload.mode !== undefined) {
    if (!MODES.includes(payload.mode)) return errorResponse("Unsupported presentation mode", 400);
    row.mode = payload.mode;
  }
  if (payload.agendaItemId !== undefined) row.agenda_item_id = payload.agendaItemId || null;
  if (payload.pollId !== undefined) row.poll_id = payload.pollId || null;
  if (payload.questionId !== undefined) row.question_id = payload.questionId || null;
  if (payload.resultsVisible !== undefined) row.results_visible = Boolean(payload.resultsVisible);
  if (payload.qrVisible !== undefined) row.qr_visible = Boolean(payload.qrVisible);
  if (payload.announcementText !== undefined) row.announcement_text = clean(payload.announcementText) || null;

  await db.update("presentation_state", row, { id: `eq.${state.id}` });
  await logAudit(db, actor, "presentation_update", "presentation_state", state.id, payload);
  await broadcast(TOPIC, "presentation_changed", { mode: row.mode || state.mode });

  const updated = (await db.select<StateRow>("presentation_state", { id: `eq.${state.id}`, limit: 1 }))[0];
  return jsonResponse(await buildSnapshot(db, event, updated));
}

function clean(value?: string | null): string {
  return (value || "").trim();
}

const CONTROL_ROLES = ["superadmin", "organizer", "moderator"] as const;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();

    // Presentation content has no participant PII by design, so reads stay
    // public — the same trust model the live portal's GET endpoints already use.
    if (request.method === "GET") return await getSnapshot(db);

    if (request.method === "POST") {
      const actor = await authenticateAdmin(request, db, [...CONTROL_ROLES]);
      return await updateState(db, actor, await readJson<UpdatePayload>(request));
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Presentation failed", 500, String(error));
  }
});
