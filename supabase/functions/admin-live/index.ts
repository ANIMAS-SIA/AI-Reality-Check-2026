import { broadcast } from "../_shared/broadcast.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type EventRow = {
  id: string;
  slug: string;
};

type AgendaItem = {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at?: string;
  title: string;
  description?: string | null;
  speaker_name?: string | null;
  speaker_role?: string | null;
  speaker_company?: string | null;
  speaker_image_url?: string | null;
  status: string;
  is_break: boolean;
  display_order: number;
  materials_url?: string | null;
  video_url?: string | null;
};

type AgendaPayload = Partial<{
  id: string;
  startsAt: string;
  endsAt: string;
  title: string;
  description: string;
  speakerName: string;
  speakerRole: string;
  speakerCompany: string;
  speakerImageUrl: string;
  isBreak: boolean;
  displayOrder: number;
  materialsUrl: string;
  videoUrl: string;
}>;

function requireAdmin(request: Request): Response | null {
  const expected = Deno.env.get("ADMIN_API_KEY");
  if (!expected) return errorResponse("ADMIN_API_KEY is not configured", 500);
  const actual = request.headers.get("x-admin-key") || "";
  if (actual !== expected) return errorResponse("Unauthorized", 401);
  return null;
}

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function setCurrent(db: SupabaseRest, event: EventRow, agendaItemId: string): Promise<Response> {
  const agenda = await db.select<AgendaItem>("agenda_items", {
    event_id: `eq.${event.id}`,
    order: "display_order.asc,starts_at.asc",
  });
  const currentIndex = agenda.findIndex((item) => item.id === agendaItemId);
  if (currentIndex < 0) return errorResponse("Agenda item not found", 404);
  const current = agenda[currentIndex];
  if (current.is_break) return errorResponse("Break cannot be current live item", 400);

  for (let index = 0; index < agenda.length; index += 1) {
    const item = agenda[index];
    const status = item.is_break
      ? "break"
      : item.id === agendaItemId
        ? "now"
        : index < currentIndex
          ? "done"
          : index === currentIndex + 1
            ? "next"
            : "later";
    if (item.status !== status) {
      await db.update("agenda_items", { status }, { id: `eq.${item.id}` });
    }
  }

  const updated = await db.update("events", { current_agenda_item_id: agendaItemId }, { id: `eq.${event.id}` });
  await broadcast("live:ai-reality-check-2026", "state_changed", { current_agenda_item_id: agendaItemId });
  return jsonResponse({ event: updated[0], current_agenda_item_id: agendaItemId });
}

async function audit(db: SupabaseRest, request: Request, eventId: string, action: string, targetId?: string, metadata: Record<string, unknown> = {}) {
  const key = request.headers.get("x-admin-key") || "";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  await db.insert("admin_audit_logs", [{
    event_id: eventId,
    actor_key_hash: hash,
    action,
    target_table: targetId ? "agenda_items" : null,
    target_id: targetId || null,
    metadata,
  }]);
}

function agendaRow(eventId: string, payload: AgendaPayload) {
  return {
    event_id: eventId,
    starts_at: payload.startsAt,
    ends_at: payload.endsAt,
    title: (payload.title || "").trim(),
    description: (payload.description || "").trim() || null,
    speaker_name: (payload.speakerName || "").trim() || null,
    speaker_role: (payload.speakerRole || "").trim() || null,
    speaker_company: (payload.speakerCompany || "").trim() || null,
    speaker_image_url: (payload.speakerImageUrl || "").trim() || null,
    is_break: Boolean(payload.isBreak),
    status: payload.isBreak ? "break" : "later",
    display_order: Number(payload.displayOrder || 0),
    materials_url: (payload.materialsUrl || "").trim() || null,
    video_url: (payload.videoUrl || "").trim() || null,
  };
}

async function upsertAgenda(db: SupabaseRest, request: Request, event: EventRow, payload: AgendaPayload): Promise<Response> {
  const row = agendaRow(event.id, payload);
  if (!row.starts_at || !row.ends_at || !row.title) return errorResponse("Start, end and title are required", 400);
  if (payload.id) {
    const updated = await db.update<AgendaItem>("agenda_items", row, { id: `eq.${payload.id}` });
    await audit(db, request, event.id, "agenda_update", payload.id);
    await broadcast("live:ai-reality-check-2026", "state_changed", { agenda_item_id: payload.id, action: "update" });
    return jsonResponse({ agenda_item: updated[0] });
  }
  const inserted = await db.insert<AgendaItem>("agenda_items", [row]);
  await audit(db, request, event.id, "agenda_create", inserted[0]?.id);
  await broadcast("live:ai-reality-check-2026", "state_changed", { agenda_item_id: inserted[0]?.id, action: "create" });
  return jsonResponse({ agenda_item: inserted[0] }, 201);
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  const adminError = requireAdmin(request);
  if (adminError) return adminError;

  try {
    const db = new SupabaseRest();
    const event = await getEvent(db);

    if (request.method === "POST") {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");
      const agendaItemId = url.searchParams.get("agenda_item_id");
      if (action === "set-current" && agendaItemId) return await setCurrent(db, event, agendaItemId);
      if (action === "upsert-agenda") return await upsertAgenda(db, request, event, await readJson<AgendaPayload>(request));
      return errorResponse("Unsupported live admin action", 400);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    return errorResponse("Admin live failed", 500, String(error));
  }
});
