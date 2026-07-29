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
  body: string;
  is_anonymous: boolean;
  status: string;
  vote_count: number;
  merged_into_id: string | null;
  created_at: string;
  participants?: { first_name: string; last_name: string } | null;
};

function clean(value?: string): string {
  return (value || "").trim();
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
      const authorName = question.participants ? `${question.participants.first_name} ${question.participants.last_name}`.toLowerCase() : "";
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
  if (status === "answered") fields.answered_at = new Date().toISOString();
  if (status === "shown_on_screen") fields.shown_on_screen_at = new Date().toISOString();
  const updated = await db.update<QuestionRow>("questions", fields, { id: `eq.${questionId}` });
  if (!updated[0]) return errorResponse("Question not found", 404);
  await logAudit(db, actor, "question_status", "questions", questionId, { status });
  await broadcast(TOPIC, "question_moderated", { question_id: questionId, status });
  return jsonResponse({ question: updated[0] });
}

async function editQuestionBody(db: SupabaseRest, actor: AdminActor, questionId: string, body: string): Promise<Response> {
  const text = clean(body);
  if (!text || text.length > 280) return errorResponse("Question body must be 1-280 characters", 422);
  const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
  if (!existing) return errorResponse("Question not found", 404);
  const updated = (await db.update<QuestionRow>("questions", { body: text }, { id: `eq.${questionId}` }))[0];
  // The original wording is preserved here in the audit trail, not in the row itself.
  await logAudit(db, actor, "question_edit", "questions", questionId, { before: existing.body, after: text });
  await broadcast(TOPIC, "question_moderated", { question_id: questionId, status: updated.status });
  return jsonResponse({ question: updated });
}

async function reassignAgenda(db: SupabaseRest, actor: AdminActor, questionId: string, agendaItemId: string | null): Promise<Response> {
  const updated = await db.update<QuestionRow>("questions", { agenda_item_id: agendaItemId }, { id: `eq.${questionId}` });
  if (!updated[0]) return errorResponse("Question not found", 404);
  await logAudit(db, actor, "question_reassign", "questions", questionId, { agenda_item_id: agendaItemId });
  await broadcast(TOPIC, "question_moderated", { question_id: questionId, status: updated[0].status });
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
  await broadcast(TOPIC, "question_moderated", { question_id: targetId, status: target[0].status });
  return jsonResponse({ question: updated });
}

async function deleteQuestion(db: SupabaseRest, actor: AdminActor, questionId: string): Promise<Response> {
  const existing = (await db.select<QuestionRow>("questions", { id: `eq.${questionId}`, limit: 1 }))[0];
  if (!existing) return errorResponse("Question not found", 404);
  await db.delete("questions", { id: `eq.${questionId}` });
  await logAudit(db, actor, "question_delete", "questions", questionId, { body: existing.body });
  await broadcast(TOPIC, "question_moderated", { question_id: questionId, status: "deleted" });
  return jsonResponse({ ok: true });
}

async function exportQuestions(db: SupabaseRest): Promise<Response> {
  const questions = await db.select<QuestionRow>("questions", { order: "created_at.desc", limit: 1000 });
  const header = ["body", "status", "vote_count", "is_anonymous", "created_at"];
  const body = questions.map((row) => header.map((key) => csvCell((row as unknown as Record<string, unknown>)[key])).join(","));
  return new Response([header.join(","), ...body].join("\n"), {
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
    const db = new SupabaseRest();
    const url = new URL(request.url);

    if (request.method === "GET") {
      await authenticateAdmin(request, db, [...READ_ROLES]);
      if (url.searchParams.get("action") === "export") return await exportQuestions(db);
      return await listQuestions(db, url);
    }

    if (request.method === "POST") {
      const actor = await authenticateAdmin(request, db, [...MODERATE_ROLES]);
      const questionId = url.searchParams.get("question_id") || "";
      const action = url.searchParams.get("action") || "status";
      if (!questionId) return errorResponse("Question ID is required", 400);

      if (action === "status") {
        return await setQuestionStatus(db, actor, questionId, url.searchParams.get("status") || "");
      }
      if (action === "edit") {
        const payload = await readJson<{ body?: string }>(request);
        return await editQuestionBody(db, actor, questionId, payload.body || "");
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
