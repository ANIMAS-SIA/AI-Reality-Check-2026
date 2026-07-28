import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type EventRow = {
  id: string;
  name: string;
  current_agenda_item_id: string | null;
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
    status: item.status,
    is_break: item.is_break,
  };
}

function resolveCurrent(event: EventRow, agenda: AgendaItem[]): AgendaItem | null {
  const now = Date.now();
  const timed = agenda.find((item) => (
    !item.is_break
    && new Date(item.starts_at).getTime() <= now
    && new Date(item.ends_at).getTime() > now
  ));
  return timed
    || agenda.find((item) => item.id === event.current_agenda_item_id)
    || agenda.find((item) => item.status === "now" && !item.is_break)
    || null;
}

function resolveNext(agenda: AgendaItem[], current: AgendaItem | null): AgendaItem | null {
  if (!agenda.length) return null;
  if (!current) return agenda.find((item) => !item.is_break) || null;
  const index = agenda.findIndex((item) => item.id === current.id);
  return agenda.slice(index + 1).find((item) => !item.is_break) || null;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    const db = new SupabaseRest();
    const slug = new URL(request.url).searchParams.get("event") || "ai-reality-check-2026";
    const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
    if (!event) return errorResponse("Event not found", 404);

    const agenda = await db.select<AgendaItem>("agenda_items", {
      event_id: `eq.${event.id}`,
      order: "display_order.asc,starts_at.asc",
    });
    const current = resolveCurrent(event, agenda);
    const next = resolveNext(agenda, current);
    if (current && current.id !== event.current_agenda_item_id) {
      await db.update("events", { current_agenda_item_id: current.id }, { id: `eq.${event.id}` });
    }

    return jsonResponse({
      event: { id: event.id, name: event.name, slug },
      current: current ? toPublicAgenda(current) : null,
      next: next ? toPublicAgenda(next) : null,
      agenda: agenda.map(toPublicAgenda),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse("Live state failed", 500, String(error));
  }
});
