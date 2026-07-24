import { broadcast } from "../_shared/broadcast.ts";
import { AdminActor, AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

const TOPIC = "live:ai-reality-check-2026";
const POLL_TYPES = ["single_choice", "multiple_choice", "scale", "yes_no", "open_text", "word_cloud"] as const;
type PollTypeValue = typeof POLL_TYPES[number];

type PollSettings = Partial<{
  anonymous: boolean;
  allowAnswerChange: boolean;
  resultsVisibleLive: boolean;
  resultsAfterClose: boolean;
  showRespondentCount: boolean;
  resultsFormat: "percent" | "count" | "both";
  shuffleOptions: boolean;
  scaleMin: number;
  scaleMax: number;
  startsAt: string | null;
  endsAt: string | null;
  description: string;
}>;

type PollPayload = Partial<{
  id: string;
  title: string;
  agendaItemId: string;
  pollType: PollTypeValue;
  options: string[];
  settings: PollSettings;
  expectedUpdatedAt: string;
}>;

type EventRow = { id: string; slug: string };
type PollRow = {
  id: string;
  event_id: string;
  agenda_item_id: string | null;
  title: string;
  poll_type: PollTypeValue;
  status: string;
  allow_anonymous: boolean;
  results_public: boolean;
  settings: PollSettings;
  updated_at: string;
};
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string };
type TextResponseRow = { id: string; poll_id: string; response_text: string; hidden: boolean };

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
  const votes = await db.select<{ poll_id: string }>("poll_votes", { select: "poll_id" });
  const textResponses = await db.select<{ poll_id: string }>("poll_text_responses", { select: "poll_id" });
  const counts = new Map<string, number>();
  for (const row of votes) counts.set(row.poll_id, (counts.get(row.poll_id) || 0) + 1);
  for (const row of textResponses) counts.set(row.poll_id, (counts.get(row.poll_id) || 0) + 1);

  return jsonResponse({
    polls: polls.map((poll) => ({ ...poll, response_count: counts.get(poll.id) || 0 })),
  });
}

function scaleOptions(settings: PollSettings): string[] {
  const min = Number.isFinite(settings.scaleMin) ? Number(settings.scaleMin) : 1;
  const max = Number.isFinite(settings.scaleMax) ? Number(settings.scaleMax) : 5;
  const options: string[] = [];
  for (let value = min; value <= max && options.length < 11; value += 1) options.push(String(value));
  return options;
}

function optionsForType(pollType: PollTypeValue, provided: string[], settings: PollSettings): string[] {
  if (pollType === "yes_no") return ["Jā", "Nē"];
  if (pollType === "scale") return scaleOptions(settings);
  if (pollType === "open_text" || pollType === "word_cloud") return [];
  return provided.map(clean).filter(Boolean).slice(0, 8);
}

async function createPoll(db: SupabaseRest, actor: AdminActor, event: EventRow, payload: PollPayload): Promise<Response> {
  const title = clean(payload.title);
  if (!title) return errorResponse("Poll title is required", 400);
  const pollType = POLL_TYPES.includes(payload.pollType as PollTypeValue) ? (payload.pollType as PollTypeValue) : "single_choice";
  const settings = payload.settings || {};
  const options = optionsForType(pollType, payload.options || [], settings);
  if (["single_choice", "multiple_choice", "scale"].includes(pollType) && options.length < 2) {
    return errorResponse("At least two options are required", 422);
  }

  const poll = (await db.insert<PollRow>("polls", [{
    event_id: event.id,
    agenda_item_id: clean(payload.agendaItemId) || null,
    title,
    poll_type: pollType,
    status: "draft",
    allow_anonymous: settings.anonymous !== false,
    results_public: false,
    settings,
  }]))[0];

  if (options.length) {
    await db.insert("poll_options", options.map((label, index) => ({
      poll_id: poll.id,
      label,
      display_order: index + 1,
    })));
  }

  await logAudit(db, actor, "poll_create", "polls", poll.id, { poll_type: pollType });
  await broadcast(TOPIC, "poll_changed", { poll_id: poll.id, action: "create" });
  return jsonResponse({ poll }, 201);
}

async function updatePoll(db: SupabaseRest, actor: AdminActor, pollId: string, payload: PollPayload): Promise<Response> {
  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);
  if (!["draft", "ready"].includes(poll.status)) {
    return errorResponse("Only draft or ready polls can be edited — pause or archive first", 409);
  }
  if (payload.expectedUpdatedAt && poll.updated_at !== payload.expectedUpdatedAt) {
    return jsonResponse({ error: "conflict", poll }, 409);
  }

  const title = payload.title !== undefined ? clean(payload.title) : poll.title;
  if (!title) return errorResponse("Poll title is required", 400);
  const pollType = POLL_TYPES.includes(payload.pollType as PollTypeValue) ? (payload.pollType as PollTypeValue) : poll.poll_type;
  const settings = { ...poll.settings, ...(payload.settings || {}) };

  const updated = (await db.update<PollRow>("polls", {
    title,
    poll_type: pollType,
    agenda_item_id: payload.agendaItemId !== undefined ? (clean(payload.agendaItemId) || null) : poll.agenda_item_id,
    allow_anonymous: settings.anonymous !== false,
    settings,
  }, { id: `eq.${pollId}` }))[0];

  if (payload.options) {
    const options = optionsForType(pollType, payload.options, settings);
    if (["single_choice", "multiple_choice", "scale"].includes(pollType) && options.length < 2) {
      return errorResponse("At least two options are required", 422);
    }
    // Safe to replace outright: edits are only allowed while draft/ready, i.e. before any votes exist.
    await db.delete("poll_options", { poll_id: `eq.${pollId}` });
    if (options.length) {
      await db.insert("poll_options", options.map((label, index) => ({
        poll_id: pollId,
        label,
        display_order: index + 1,
      })));
    }
  }

  await logAudit(db, actor, "poll_update", "polls", pollId, { fields: Object.keys(payload) });
  await broadcast(TOPIC, "poll_changed", { poll_id: pollId, action: "update" });
  return jsonResponse({ poll: updated });
}

async function setStatus(db: SupabaseRest, actor: AdminActor, pollId: string, action: string): Promise<Response> {
  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);

  const fields: Record<string, unknown> = {};
  if (action === "activate") {
    if (["single_choice", "multiple_choice", "scale"].includes(poll.poll_type)) {
      const options = await db.select<PollOptionRow>("poll_options", { poll_id: `eq.${pollId}` });
      if (options.length < 2) return errorResponse("Poll needs at least two options before it can go live", 422);
    }
    fields.status = "active";
    fields.activated_at = new Date().toISOString();
    if (actor.role !== "superadmin") {
      await db.update("polls", { status: "closed", closed_at: new Date().toISOString() }, {
        event_id: `eq.${poll.event_id}`,
        status: "eq.active",
      });
    }
  } else if (action === "pause") {
    fields.status = "paused";
  } else if (action === "reopen") {
    if (!["paused", "closed"].includes(poll.status)) return errorResponse("Only a paused or closed poll can be reopened", 409);
    fields.status = "active";
  } else if (action === "close") {
    fields.status = "closed";
    fields.closed_at = new Date().toISOString();
  } else if (action === "publish") {
    fields.status = "closed";
    fields.closed_at = new Date().toISOString();
    fields.results_public = true;
  } else if (action === "unpublish") {
    fields.results_public = false;
  } else if (action === "archive") {
    fields.status = "archived";
  } else {
    return errorResponse("Unsupported poll action", 400);
  }

  const updated = (await db.update<PollRow>("polls", fields, { id: `eq.${pollId}` }))[0];
  await logAudit(db, actor, `poll_${action}`, "polls", pollId);
  await broadcast(TOPIC, "poll_changed", { poll_id: pollId, action });
  return jsonResponse({ poll: updated });
}

async function clearResponses(db: SupabaseRest, actor: AdminActor, pollId: string): Promise<Response> {
  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);

  await db.delete("poll_votes", { poll_id: `eq.${pollId}` });
  await db.delete("poll_text_responses", { poll_id: `eq.${pollId}` });

  await logAudit(db, actor, "poll_clear_responses", "polls", pollId);
  await broadcast(TOPIC, "poll_changed", { poll_id: pollId, action: "clear-responses" });
  return jsonResponse({ ok: true });
}

async function exportPoll(db: SupabaseRest, pollId: string): Promise<Response> {
  const poll = (await db.select<PollRow>("polls", { id: `eq.${pollId}`, limit: 1 }))[0];
  if (!poll) return errorResponse("Poll not found", 404);

  if (poll.poll_type === "open_text" || poll.poll_type === "word_cloud") {
    const responses = await db.select<TextResponseRow>("poll_text_responses", {
      poll_id: `eq.${pollId}`,
      hidden: "eq.false",
      order: "created_at.asc",
    });
    const rows = ["response"].join(",") + "\n" + responses.map((row) => `"${row.response_text.replace(/"/g, '""')}"`).join("\n");
    return csvResponse(rows, `poll-${pollId}-responses.csv`);
  }

  const options = await db.select<PollOptionRow>("poll_options", { poll_id: `eq.${pollId}`, order: "display_order.asc" });
  const votes = await db.select<PollVoteRow>("poll_votes", { poll_id: `eq.${pollId}` });
  const total = votes.length;
  const header = "option,votes,percent";
  const body = options.map((option) => {
    const count = votes.filter((vote) => vote.option_id === option.id).length;
    const percent = total ? Math.round((count / total) * 100) : 0;
    return `"${option.label.replace(/"/g, '""')}",${count},${percent}`;
  }).join("\n");
  return csvResponse(`${header}\n${body}`, `poll-${pollId}-results.csv`);
}

function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const READ_ROLES = ["superadmin", "organizer", "moderator", "viewer"] as const;
const MANAGE_ROLES = ["superadmin", "organizer"] as const;
const CONTROL_ROLES = ["superadmin", "organizer", "moderator"] as const;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const event = await getEvent(db);
    const url = new URL(request.url);

    if (request.method === "GET") {
      const action = url.searchParams.get("action");
      const pollId = url.searchParams.get("poll_id") || "";
      if (action === "export" && pollId) {
        await authenticateAdmin(request, db, [...READ_ROLES]);
        return await exportPoll(db, pollId);
      }
      await authenticateAdmin(request, db, [...READ_ROLES]);
      return await listPolls(db, event.id);
    }

    if (request.method === "POST") {
      const action = url.searchParams.get("action") || "create";
      if (action === "create") {
        const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
        return await createPoll(db, actor, event, await readJson<PollPayload>(request));
      }
      const pollId = url.searchParams.get("poll_id") || "";
      if (!pollId) return errorResponse("Poll ID is required", 400);

      if (action === "update") {
        const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
        return await updatePoll(db, actor, pollId, await readJson<PollPayload>(request));
      }
      if (["activate", "close", "pause", "reopen", "publish", "unpublish"].includes(action)) {
        const actor = await authenticateAdmin(request, db, [...CONTROL_ROLES]);
        return await setStatus(db, actor, pollId, action);
      }
      if (action === "archive") {
        const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
        return await setStatus(db, actor, pollId, action);
      }
      if (action === "clear-responses") {
        const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
        return await clearResponses(db, actor, pollId);
      }
      return errorResponse("Unsupported poll action", 400);
    }
    return errorResponse("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Admin polls failed", 500, String(error));
  }
});
