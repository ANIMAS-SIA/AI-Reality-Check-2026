import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { resolveAgenda } from "../_shared/agenda.ts";

type EventRow = {
  id: string;
  name: string;
  capacity: number;
  current_agenda_item_id: string | null;
  agenda_mode: string;
  starts_at: string;
  ends_at: string;
  is_test: boolean;
};

type AgendaItem = {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  title: string;
  description: string | null;
  speaker_name: string | null;
  speaker_role: string | null;
  speaker_company: string | null;
  speaker_image_url: string | null;
  category: string | null;
  status: string;
  is_break: boolean;
  display_order: number;
};

function toPublicAgenda(item: AgendaItem) {
  return {
    id: item.id,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    time: new Intl.DateTimeFormat("lv-LV", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Riga",
    }).format(new Date(item.starts_at)),
    title: item.title,
    description: item.description || "",
    speaker_name: item.speaker_name || "",
    speaker_role: item.speaker_role || "",
    speaker_company: item.speaker_company || "",
    speaker_image_url: item.speaker_image_url || "",
    category: item.category || "",
    status: item.status,
    is_break: item.is_break,
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    const db = new SupabaseRest(request);
    await db.assertRehearsalSafe(request);
    const slug = db.eventSlug;
    const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
    if (!event) return errorResponse("Event not found", 404);

    const agenda = await db.select<AgendaItem>("agenda_items", {
      event_id: `eq.${event.id}`,
      order: "display_order.asc,starts_at.asc",
    });
    const approvedParticipants = await db.select<{ id: string }>("participants", {
      event_id: `eq.${event.id}`,
      status: "in.(approved,arrived)",
      limit: event.capacity + 1,
    });
    const approvedCount = Math.min(approvedParticipants.length, event.capacity);
    const resolved = resolveAgenda(event, agenda);
    const { current, next } = resolved;

    return jsonResponse({
      event: {
        id: event.id,
        name: event.name,
        slug,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        is_test: event.is_test,
        agenda_mode: event.agenda_mode,
        capacity: event.capacity,
        approved_count: approvedCount,
        available_seats: Math.max(0, event.capacity - approvedCount),
      },
      current: current ? toPublicAgenda(current) : null,
      next: next ? toPublicAgenda(next) : null,
      agenda: resolved.agenda.map(toPublicAgenda),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse("Live state failed", 500, String(error));
  }
});
