import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type EventRow = { id: string; slug: string; name: string; archive_enabled: boolean };
type AgendaRow = {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  description: string | null;
  speaker_name: string | null;
  speaker_company: string | null;
  materials_url: string | null;
  video_url: string | null;
  display_order: number;
};
type QuestionRow = { id: string; agenda_item_id: string | null; body: string; vote_count: number; answered_at: string | null };

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    const db = new SupabaseRest();
    const url = new URL(request.url);
    const slug = url.searchParams.get("event") || "ai-reality-check-2026";
    const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
    if (!event) return errorResponse("Event not found", 404);

    const agenda = await db.select<AgendaRow>("agenda_items", {
      event_id: `eq.${event.id}`,
      order: "display_order.asc,starts_at.asc",
    });
    const questions = await db.select<QuestionRow>("questions", {
      event_id: `eq.${event.id}`,
      status: "eq.answered",
      order: "vote_count.desc,created_at.desc",
      limit: 200,
    });

    const functionsUrl = `${(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "")}/functions/v1`;
    const results = await fetch(`${functionsUrl}/results`).then((response) => response.json()).catch(() => null);

    return jsonResponse({
      event,
      agenda,
      questions,
      results,
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse("Archive failed", 500, String(error));
  }
});
