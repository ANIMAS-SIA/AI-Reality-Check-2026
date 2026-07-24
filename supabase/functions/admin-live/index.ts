import { broadcast } from "../_shared/broadcast.ts";
import { AdminActor, AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

const TOPIC = "live:ai-reality-check-2026";

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
  category?: string | null;
  status: string;
  is_break: boolean;
  display_order: number;
  materials_url?: string | null;
  video_url?: string | null;
  questions_enabled?: boolean;
  updated_at?: string;
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
  category: string;
  isBreak: boolean;
  displayOrder: number;
  materialsUrl: string;
  videoUrl: string;
  questionsEnabled: boolean;
  expectedUpdatedAt: string;
}>;

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function listAgenda(db: SupabaseRest, event: EventRow): Promise<Response> {
  const agenda = await db.select<AgendaItem>("agenda_items", {
    event_id: `eq.${event.id}`,
    order: "display_order.asc,starts_at.asc",
  });
  const questions = await db.select<{ agenda_item_id: string | null }>("questions", {
    event_id: `eq.${event.id}`,
    select: "agenda_item_id",
  });
  const polls = await db.select<{ agenda_item_id: string | null }>("polls", {
    event_id: `eq.${event.id}`,
    select: "agenda_item_id",
  });

  const questionCounts = new Map<string, number>();
  for (const row of questions) {
    if (!row.agenda_item_id) continue;
    questionCounts.set(row.agenda_item_id, (questionCounts.get(row.agenda_item_id) || 0) + 1);
  }
  const pollCounts = new Map<string, number>();
  for (const row of polls) {
    if (!row.agenda_item_id) continue;
    pollCounts.set(row.agenda_item_id, (pollCounts.get(row.agenda_item_id) || 0) + 1);
  }

  return jsonResponse({
    agenda: agenda.map((item) => ({
      ...item,
      question_count: questionCounts.get(item.id) || 0,
      poll_count: pollCounts.get(item.id) || 0,
    })),
  });
}

async function setCurrent(db: SupabaseRest, actor: AdminActor, event: EventRow, agendaItemId: string): Promise<Response> {
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
    if (item.is_break || item.status === "cancelled") continue;
    const status = item.id === agendaItemId
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
  await logAudit(db, actor, "agenda_set_current", "agenda_items", agendaItemId);
  await broadcast(TOPIC, "state_changed", { current_agenda_item_id: agendaItemId });
  return jsonResponse({ event: updated[0], current_agenda_item_id: agendaItemId });
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
    category: (payload.category || "").trim() || null,
    is_break: Boolean(payload.isBreak),
    display_order: Number(payload.displayOrder || 0),
    materials_url: (payload.materialsUrl || "").trim() || null,
    video_url: (payload.videoUrl || "").trim() || null,
    questions_enabled: payload.questionsEnabled !== false,
  };
}

async function upsertAgenda(db: SupabaseRest, actor: AdminActor, event: EventRow, payload: AgendaPayload): Promise<Response> {
  const row = agendaRow(event.id, payload);
  if (!row.starts_at || !row.ends_at || !row.title) return errorResponse("Start, end and title are required", 400);

  if (payload.id) {
    if (payload.expectedUpdatedAt) {
      const current = (await db.select<AgendaItem>("agenda_items", { id: `eq.${payload.id}`, limit: 1 }))[0];
      if (current?.updated_at && current.updated_at !== payload.expectedUpdatedAt) {
        return jsonResponse({ error: "conflict", agenda_item: current }, 409);
      }
    }
    // Status is only changed through set-current / cancel — never clobbered by a content edit.
    const updated = await db.update<AgendaItem>("agenda_items", row, { id: `eq.${payload.id}` });
    if (!updated[0]) return errorResponse("Agenda item not found", 404);
    await logAudit(db, actor, "agenda_update", "agenda_items", payload.id, { fields: Object.keys(row) });
    await broadcast(TOPIC, "state_changed", { agenda_item_id: payload.id, action: "update" });
    return jsonResponse({ agenda_item: updated[0] });
  }

  const inserted = await db.insert<AgendaItem>("agenda_items", [{ ...row, status: row.is_break ? "break" : "later" }]);
  await logAudit(db, actor, "agenda_create", "agenda_items", inserted[0]?.id);
  await broadcast(TOPIC, "state_changed", { agenda_item_id: inserted[0]?.id, action: "create" });
  return jsonResponse({ agenda_item: inserted[0] }, 201);
}

async function cancelAgendaItem(db: SupabaseRest, actor: AdminActor, agendaItemId: string): Promise<Response> {
  const updated = await db.update<AgendaItem>("agenda_items", { status: "cancelled" }, { id: `eq.${agendaItemId}` });
  if (!updated[0]) return errorResponse("Agenda item not found", 404);
  await logAudit(db, actor, "agenda_cancel", "agenda_items", agendaItemId);
  await broadcast(TOPIC, "state_changed", { agenda_item_id: agendaItemId, action: "cancel" });
  return jsonResponse({ agenda_item: updated[0] });
}

async function duplicateAgendaItem(db: SupabaseRest, actor: AdminActor, event: EventRow, agendaItemId: string): Promise<Response> {
  const source = (await db.select<AgendaItem>("agenda_items", { id: `eq.${agendaItemId}`, limit: 1 }))[0];
  if (!source) return errorResponse("Agenda item not found", 404);

  const inserted = await db.insert<AgendaItem>("agenda_items", [{
    event_id: event.id,
    starts_at: source.starts_at,
    ends_at: source.ends_at,
    title: `${source.title} (kopija)`,
    description: source.description ?? null,
    speaker_name: source.speaker_name ?? null,
    speaker_role: source.speaker_role ?? null,
    speaker_company: source.speaker_company ?? null,
    speaker_image_url: source.speaker_image_url ?? null,
    category: source.category ?? null,
    is_break: source.is_break,
    status: source.is_break ? "break" : "later",
    display_order: (source.display_order || 0) + 1,
    materials_url: source.materials_url ?? null,
    video_url: source.video_url ?? null,
    questions_enabled: source.questions_enabled !== false,
  }]);
  await logAudit(db, actor, "agenda_duplicate", "agenda_items", inserted[0]?.id, { source_id: agendaItemId });
  await broadcast(TOPIC, "state_changed", { agenda_item_id: inserted[0]?.id, action: "create" });
  return jsonResponse({ agenda_item: inserted[0] }, 201);
}

async function reorderAgenda(db: SupabaseRest, actor: AdminActor, event: EventRow, orderedIds: string[]): Promise<Response> {
  if (!orderedIds.length) return errorResponse("Order list is required", 400);
  for (let index = 0; index < orderedIds.length; index += 1) {
    await db.update("agenda_items", { display_order: index + 1 }, {
      id: `eq.${orderedIds[index]}`,
      event_id: `eq.${event.id}`,
    });
  }
  await logAudit(db, actor, "agenda_reorder", "agenda_items", undefined, { order: orderedIds });
  await broadcast(TOPIC, "state_changed", { action: "reorder" });
  return jsonResponse({ ok: true });
}

const READ_ROLES = ["superadmin", "organizer", "moderator", "viewer"] as const;
const WRITE_ROLES = ["superadmin", "organizer"] as const;
const LIVE_CONTROL_ROLES = ["superadmin", "organizer", "moderator"] as const;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const event = await getEvent(db);
    const url = new URL(request.url);

    if (request.method === "GET") {
      await authenticateAdmin(request, db, [...READ_ROLES]);
      return await listAgenda(db, event);
    }

    if (request.method === "POST") {
      const action = url.searchParams.get("action");
      const agendaItemId = url.searchParams.get("agenda_item_id");

      if (action === "set-current" && agendaItemId) {
        const actor = await authenticateAdmin(request, db, [...LIVE_CONTROL_ROLES]);
        return await setCurrent(db, actor, event, agendaItemId);
      }
      if (action === "upsert-agenda") {
        const actor = await authenticateAdmin(request, db, [...WRITE_ROLES]);
        return await upsertAgenda(db, actor, event, await readJson<AgendaPayload>(request));
      }
      if (action === "cancel" && agendaItemId) {
        const actor = await authenticateAdmin(request, db, [...WRITE_ROLES]);
        return await cancelAgendaItem(db, actor, agendaItemId);
      }
      if (action === "duplicate" && agendaItemId) {
        const actor = await authenticateAdmin(request, db, [...WRITE_ROLES]);
        return await duplicateAgendaItem(db, actor, event, agendaItemId);
      }
      if (action === "reorder") {
        const actor = await authenticateAdmin(request, db, [...WRITE_ROLES]);
        const payload = await readJson<{ order?: string[] }>(request);
        return await reorderAgenda(db, actor, event, payload.order || []);
      }
      return errorResponse("Unsupported live admin action", 400);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Admin live failed", 500, String(error));
  }
});
