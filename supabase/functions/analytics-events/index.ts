import { errorResponse, handleOptions, jsonResponse, readJson } from "../_shared/http.ts";
import { rateLimit } from "../_shared/rate-limit.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

const ALLOWED_EVENTS = [
  "maturity_step_viewed",
  "maturity_slider_changed",
  "maturity_level_selected",
  "maturity_answer_submitted",
  "maturity_answer_submitted_anonymously",
  "maturity_step_abandoned",
];

type EventPayload = {
  eventName?: string;
  properties?: Record<string, unknown>;
};

function sanitizeProperties(properties: Record<string, unknown> | undefined): Record<string, unknown> {
  // Only ever forward the small, non-identifying shape the spec defines —
  // never trust the client to decide what counts as "not personal data".
  const allowedKeys = ["registrationStep", "maturityLevel", "maturityPhase", "anonymous"];
  const clean: Record<string, unknown> = {};
  for (const key of allowedKeys) {
    if (properties && properties[key] !== undefined) clean[key] = properties[key];
  }
  return clean;
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  if (request.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    const db = new SupabaseRest();
    const limited = await rateLimit(db, request, "analytics-events", 60, 60);
    if (limited) return limited;

    const payload = await readJson<EventPayload>(request);
    const eventName = (payload.eventName || "").trim();
    if (!ALLOWED_EVENTS.includes(eventName)) return errorResponse("Unsupported event name", 400);

    await db.insert("analytics_events", [{
      event_name: eventName,
      properties: sanitizeProperties(payload.properties),
    }]);

    return jsonResponse({ ok: true });
  } catch (error) {
    return errorResponse("Analytics event failed", 500, String(error));
  }
});
