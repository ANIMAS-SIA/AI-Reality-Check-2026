import { broadcast } from "../_shared/broadcast.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type PollPayload = {
  title?: string;
  agendaItemId?: string;
  options?: string[];
};
type EventRow = { id: string; slug: string };
type PollRow = { id: string; event_id: string; title: string; status: string; results_public: boolean };

function requireAdmin(request: Request): Response | null {
  const expected = Deno.env.get("ADMIN_API_KEY");
  if (!expected) return errorResponse("ADMIN_API_KEY is not configured", 500);
  const actual = request.headers.get("x-admin-key") || "";
  if (actual !== expected) return errorResponse("Unauthorized", 401);
  return null;
}

function clean(value?: string): string {
  return (value || "").trim();
}

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function listPolls(db: SupabaseRest, eventId: string): Promise<Response> {
  const polls = await db.select<PollRow>("polls", {
    event_id: `eq.${eventId}`,
    order: "created_at.asc",
  });
  return jsonResponse({ polls });
}

async function createPoll(db: SupabaseRest, event: EventRow, payload: PollPayload): Promise<Response> {
  const title = clean(payload.title);
  const options = (payload.options || []).map(clean).filter(Boolean).slice(0, 8);
  if (!title) return errorResponse("Poll title is required", 400);
  if (options.length < 2) return errorResponse("At least two options are required", 400);

  const poll = (await db.insert<PollRow>("polls", [{
    event_id: event.id,
    agenda_item_id: clean(payload.agendaItemId) || null,
    title,
    status: "draft",
    allow_anonymous: true,
    results_public: false,
  }]))[0];
  await db.insert("poll_options", options.map((label, index) => ({
    poll_id: poll.id,
    label,
    display_order: index + 1,
  })));
  await broadcast("live:ai-reality-check-2026", "poll_changed", { poll_id: poll.id });
  return jsonResponse({ poll }, 201);
}

async function setStatus(db: SupabaseRest, pollId: string, action: string): Promise<Response> {
  const fields: Record<string, unknown> = {};
  if (action === "activate") {
    fields.status = "active";
    fields.activated_at = new Date().toISOString();
    await db.update("polls", { status: "closed" }, { status: "eq.active" });
  } else if (action === "close") {
    fields.status = "closed";
    fields.closed_at = new Date().toISOString();
  } else if (action === "publish") {
    fields.status = "published";
    fields.results_public = true;
    fields.closed_at = new Date().toISOString();
  } else if (action === "unpublish") {
    fields.results_public = false;
  } else {
    return errorResponse("Unsupported poll action", 400);
  }
  const poll = (await db.update<PollRow>("polls", fields, { id: `eq.${pollId}` }))[0];
  await broadcast("live:ai-reality-check-2026", "poll_changed", { poll_id: pollId, action });
  return jsonResponse({ poll });
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const adminError = requireAdmin(request);
  if (adminError) return adminError;

  try {
    const db = new SupabaseRest();
    const event = await getEvent(db);
    const url = new URL(request.url);

    if (request.method === "GET") return await listPolls(db, event.id);
    if (request.method === "POST") {
      const action = url.searchParams.get("action") || "create";
      if (action === "create") return await createPoll(db, event, await readJson<PollPayload>(request));
      const pollId = url.searchParams.get("poll_id") || "";
      if (!pollId) return errorResponse("Poll ID is required", 400);
      return await setStatus(db, pollId, action);
    }
    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Admin polls failed", 500, String(error));
  }
});
