import { broadcast } from "../_shared/broadcast.ts";
import { AdminActor, AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

const TOPIC = "live:ai-reality-check-2026";
const STATUSES = ["pending", "approved", "rejected", "highlighted", "shown_on_screen", "answered", "archived"] as const;

type QuestionRow = {
  id: string;
  event_id: string;
  agenda_item_id: string | null;
  participant_id: string | null;
  guest_name: string | null;
  body: string;
  is_anonymous: boolean;
  status: string;
  vote_count: number;
  merged_into_id: string | null;
  answer_body: string | null;
  answered_at: string | null;
  answer_updated_at: string | null;
  created_at: string;
  participants?: { first_name: string; last_name: string } | null;
  agenda_items?: { title: string; speaker_name: string | null } | null;
};

function clean(value?: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function listQuestions(db: SupabaseRest, url: URL): Promise<Response> {
  const query: Record<string, string | number> = {
    select: "*,participants(first_name,last_name)",
    order: "created_at.desc",
    limit: 300,
  };
  const status = url.searchParams.get("status");
  const agendaItemId = url.searchParams.get("agenda_item_id");
  if (status && status !== "all") query.status = `eq.${status}`;
  if (agendaItemId && agendaItemId !== "all") query.agenda_item_id = `eq.${agendaItemId}`;

  let questions = await db.select<QuestionRow>("questions", query);

  const search = clean(url.searchParams.get("search") || "").toLowerCase();
  if (search) {
    questions = questions.filter((question) => {
      const authorName = question.participants
        ? `${question.participants.first_name} ${question.participants.last_name}`.toLowerCase()
        : (question.guest_name || "").toLowerCase();
      return question.body.toLowerCase().includes(search) || authorName.includes(search);
    });
  }
  const authorType = url.searchParams.get("author_type");
  if (authorType === "anonymous") questions = questions.filter((question) => question.is_anonymous);
  if (authorType === "identified") questions = questions.filter((question) => !question.is_anonymous);

  return jsonResponse({ questions });
}

async function setQuestionStatus(db: SupabaseRest, actor: AdminActor, questionId: string, status: string): Promise<Response> {
  if (!STATUSES.includes(status as typeof STATUSES[number])) return errorResponse("Unsupported status", 400);
  const fields: Record<string, unknown> = { status };
  if (status === "answered") {
    const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
    if (!existing) return errorResponse("Question not found", 404);
    if (!existing.answer_body) return errorResponse("Pirms statusa “Atbildēts” pievieno publicējamu atbildi.", 422);
    fields.answered_at = existing.answered_at || new Date().toISOString();
  }
  if (status === "shown_on_screen") fields.shown_on_screen_at = new Date().toISOString();
  const updated = await db.update<QuestionRow>("questions", fields, { id: `eq.${questionId}` });
  if (!updated[0]) return errorResponse("Question not found", 404);
  await logAudit(db, actor, "question_status", "questions", questionId, { status });
  await broadcast(db.topic, "question_moderated", { question_id: questionId, status });
  return jsonResponse({ question: updated[0] });
}

function validAnswer(value?: unknown): string | null {
  const answer = clean(value);
  return answer && answer.length <= 4000 ? answer : null;
}

async function setQuestionAnswer(db: SupabaseRest, actor: AdminActor, questionId: string, rawAnswer: string): Promise<Response> {
  const answer = validAnswer(rawAnswer);
  if (!answer) return errorResponse("Atbildei jābūt 1–4000 rakstzīmes garai.", 422);
  const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
  if (!existing) return errorResponse("Question not found", 404);
  const now = new Date().toISOString();
  const updated = (await db.update<QuestionRow>("questions", {
    answer_body: answer,
    status: "answered",
    answered_at: existing.answered_at || now,
    answer_updated_at: now,
    answer_updated_by: actor.userId,
  }, { id: `eq.${questionId}` }))[0];
  if (!updated) return errorResponse("Question not found", 404);
  await logAudit(db, actor, "question_answer", "questions", questionId, { answer_length: answer.length });
  await broadcast(db.topic, "question_answered", { question_id: questionId });
  return jsonResponse({ question: updated });
}

async function deleteQuestionAnswer(db: SupabaseRest, actor: AdminActor, questionId: string): Promise<Response> {
  const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
  if (!existing) return errorResponse("Question not found", 404);
  if (!existing.answer_body) return errorResponse("Šim jautājumam nav dzēšamas atbildes.", 409);
  const updated = (await db.update<QuestionRow>("questions", {
    answer_body: null,
    status: "approved",
    answered_at: null,
    answer_updated_at: new Date().toISOString(),
    answer_updated_by: actor.userId,
  }, { id: `eq.${questionId}` }))[0];
  await logAudit(db, actor, "question_answer_delete", "questions", questionId, { answer_length: existing.answer_body.length });
  await broadcast(db.topic, "question_answer_deleted", { question_id: questionId });
  return jsonResponse({ question: updated });
}

type BulkAnswer = { questionId?: unknown; answer?: unknown };

async function bulkAnswerQuestions(db: SupabaseRest, actor: AdminActor, rows: BulkAnswer[]): Promise<Response> {
  if (!Array.isArray(rows) || !rows.length || rows.length > 250) {
    return errorResponse("Importā jābūt 1–250 atbildēm.", 422);
  }
  const seen = new Set<string>();
  const answers: Array<{ questionId: string; answer: string }> = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") return errorResponse("Importā ir nederīga rinda.", 422);
    const questionId = clean(row.questionId);
    const answer = validAnswer(row.answer);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(questionId)) {
      return errorResponse("Importā ir nederīgs question_id.", 422);
    }
    if (!answer) return errorResponse("Katrai rindai vajadzīga 1–4000 rakstzīmju atbilde.", 422);
    if (seen.has(questionId)) return errorResponse("Importā question_id nedrīkst atkārtoties.", 422);
    seen.add(questionId);
    answers.push({ questionId, answer });
  }

  const event = await db.event();
  const updated = await db.rpc<number>("bulk_answer_questions", {
    p_event_id: event.id,
    p_actor_user_id: actor.userId,
    p_answers: answers,
  });
  await logAudit(db, actor, "question_answers_bulk", "questions", undefined, { count: updated });
  await broadcast(db.topic, "question_answers_imported", { count: updated });
  return jsonResponse({ updated });
}

async function editQuestionBody(db: SupabaseRest, actor: AdminActor, questionId: string, body: string): Promise<Response> {
  const text = clean(body);
  if (!text || text.length > 280) return errorResponse("Question body must be 1-280 characters", 422);
  const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
  if (!existing) return errorResponse("Question not found", 404);
  const updated = (await db.update<QuestionRow>("questions", { body: text }, { id: `eq.${questionId}` }))[0];
  // The original wording is preserved here in the audit trail, not in the row itself.
  await logAudit(db, actor, "question_edit", "questions", questionId, { before: existing.body, after: text });
  await broadcast(db.topic, "question_moderated", { question_id: questionId, status: updated.status });
  return jsonResponse({ question: updated });
}

async function reassignAgenda(db: SupabaseRest, actor: AdminActor, questionId: string, agendaItemId: string | null): Promise<Response> {
  const updated = await db.update<QuestionRow>("questions", { agenda_item_id: agendaItemId }, { id: `eq.${questionId}` });
  if (!updated[0]) return errorResponse("Question not found", 404);
  await logAudit(db, actor, "question_reassign", "questions", questionId, { agenda_item_id: agendaItemId });
  await broadcast(db.topic, "question_moderated", { question_id: questionId, status: updated[0].status });
  return jsonResponse({ question: updated[0] });
}

async function mergeQuestions(db: SupabaseRest, actor: AdminActor, sourceId: string, targetId: string): Promise<Response> {
  if (sourceId === targetId) return errorResponse("Cannot merge a question into itself", 400);
  const [source, target] = await Promise.all([
    db.select<QuestionRow>("questions", { id: `eq.${sourceId}`, limit: 1 }),
    db.select<QuestionRow>("questions", { id: `eq.${targetId}`, limit: 1 }),
  ]);
  if (!source[0] || !target[0]) return errorResponse("Question not found", 404);

  const combinedVotes = (source[0].vote_count || 0) + (target[0].vote_count || 0);
  await db.update("questions", { vote_count: combinedVotes }, { id: `eq.${targetId}` });
  const updated = (await db.update<QuestionRow>("questions", {
    status: "archived",
    merged_into_id: targetId,
  }, { id: `eq.${sourceId}` }))[0];

  await logAudit(db, actor, "question_merge", "questions", sourceId, { merged_into_id: targetId });
  await broadcast(db.topic, "question_moderated", { question_id: targetId, status: target[0].status });
  return jsonResponse({ question: updated });
}

async function deleteQuestion(db: SupabaseRest, actor: AdminActor, questionId: string): Promise<Response> {
  const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
  if (!existing) return errorResponse("Question not found", 404);
  await db.delete("questions", { id: `eq.${questionId}` });
  await logAudit(db, actor, "question_delete", "questions", questionId, { body: existing.body });
  await broadcast(db.topic, "question_moderated", { question_id: questionId, status: "deleted" });
  return jsonResponse({ ok: true });
}

async function exportQuestions(db: SupabaseRest, url: URL): Promise<Response> {
  const query: Record<string, string | number> = {
    select: "*,agenda_items(title,speaker_name)",
    order: "created_at.desc",
    limit: 1000,
  };
  const agendaItemId = clean(url.searchParams.get("agenda_item_id"));
  if (agendaItemId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(agendaItemId)) {
    return errorResponse("Invalid agenda_item_id", 422);
  }
  if (agendaItemId) query.agenda_item_id = `eq.${agendaItemId}`;
  const questions = await db.select<QuestionRow>("questions", query);
  const header = ["question_id", "agenda_item_id", "programmas_punkts", "speaker", "question", "answer", "status", "vote_count", "created_at"];
  const body = questions.map((row) => [
    row.id,
    row.agenda_item_id,
    row.agenda_items?.title,
    row.agenda_items?.speaker_name,
    row.body,
    row.answer_body,
    row.status,
    row.vote_count,
    row.created_at,
  ].map(csvCell).join(","));
  return new Response([`\uFEFF${header.join(",")}`, ...body].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ai-reality-check-questions.csv"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const READ_ROLES = ["superadmin", "organizer", "moderator", "viewer"] as const;
const MODERATE_ROLES = ["superadmin", "organizer", "moderator"] as const;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest(request);
    await db.assertRehearsalSafe(request);
    const url = new URL(request.url);

    if (request.method === "GET") {
      await authenticateAdmin(request, db, [...READ_ROLES]);
      if (url.searchParams.get("action") === "export") return await exportQuestions(db, url);
      return await listQuestions(db, url);
    }

    if (request.method === "POST") {
      const actor = await authenticateAdmin(request, db, [...MODERATE_ROLES]);
      const questionId = url.searchParams.get("question_id") || "";
      const action = url.searchParams.get("action") || "status";
      if (action === "bulk-answer") {
        const payload = await readJson<{ rows?: BulkAnswer[] }>(request);
        return await bulkAnswerQuestions(db, actor, payload.rows || []);
      }
      if (!questionId) return errorResponse("Question ID is required", 400);

      if (action === "status") {
        return await setQuestionStatus(db, actor, questionId, url.searchParams.get("status") || "");
      }
      if (action === "edit") {
        const payload = await readJson<{ body?: string }>(request);
        return await editQuestionBody(db, actor, questionId, payload.body || "");
      }
      if (action === "answer") {
        const payload = await readJson<{ answer?: string }>(request);
        return await setQuestionAnswer(db, actor, questionId, payload.answer || "");
      }
      if (action === "delete-answer") {
        return await deleteQuestionAnswer(db, actor, questionId);
      }
      if (action === "reassign") {
        const payload = await readJson<{ agendaItemId?: string | null }>(request);
        return await reassignAgenda(db, actor, questionId, payload.agendaItemId || null);
      }
      if (action === "merge") {
        const payload = await readJson<{ targetId?: string }>(request);
        return await mergeQuestions(db, actor, questionId, payload.targetId || "");
      }
      if (action === "delete") {
        return await deleteQuestion(db, actor, questionId);
      }
      return errorResponse("Unsupported question action", 400);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Admin questions failed", 500, String(error));
  }
});
