import { broadcast } from "../_shared/broadcast.ts";
import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type QuestionRow = {
  id: string;
  event_id: string;
  agenda_item_id: string | null;
  body: string;
  is_anonymous: boolean;
  status: string;
  vote_count: number;
  created_at: string;
};

function requireAdmin(request: Request): Response | null {
  const expected = Deno.env.get("ADMIN_API_KEY");
  if (!expected) return errorResponse("ADMIN_API_KEY is not configured", 500);
  const actual = request.headers.get("x-admin-key") || "";
  if (actual !== expected) return errorResponse("Unauthorized", 401);
  return null;
}

async function listQuestions(db: SupabaseRest, url: URL): Promise<Response> {
  const query: Record<string, string | number> = {
    order: "created_at.desc",
    limit: 200,
  };
  const status = url.searchParams.get("status");
  const agendaItemId = url.searchParams.get("agenda_item_id");
  if (status && status !== "all") query.status = `eq.${status}`;
  if (agendaItemId && agendaItemId !== "all") query.agenda_item_id = `eq.${agendaItemId}`;
  const questions = await db.select<QuestionRow>("questions", query);
  return jsonResponse({ questions });
}

async function setQuestionStatus(db: SupabaseRest, questionId: string, status: string): Promise<Response> {
  if (!["pending", "approved", "hidden", "answered", "moved_to_panel"].includes(status)) {
    return errorResponse("Unsupported status", 400);
  }
  const fields: Record<string, unknown> = { status };
  if (status === "answered") fields.answered_at = new Date().toISOString();
  const updated = await db.update<QuestionRow>("questions", fields, { id: `eq.${questionId}` });
  await broadcast("live:ai-reality-check-2026", "question_moderated", { question_id: questionId, status });
  return jsonResponse({ question: updated[0] });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const adminError = requireAdmin(request);
  if (adminError) return adminError;

  try {
    const db = new SupabaseRest();
    const url = new URL(request.url);

    if (request.method === "GET") return await listQuestions(db, url);

    if (request.method === "POST") {
      const questionId = url.searchParams.get("question_id") || "";
      const status = url.searchParams.get("status") || "";
      if (!questionId) return errorResponse("Question ID is required", 400);
      return await setQuestionStatus(db, questionId, status);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Admin questions failed", 500, String(error));
  }
});
