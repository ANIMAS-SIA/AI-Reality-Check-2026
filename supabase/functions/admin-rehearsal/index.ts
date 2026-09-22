import { AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { createToken, hashToken, addDays } from "../_shared/tokens.ts";

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "POST") return errorResponse("Method not allowed", 405);
  try {
    const db = new SupabaseRest(request);
    const actor = await authenticateAdmin(request, db, ["superadmin", "organizer"]);
    const event = await db.event();
    const action = new URL(request.url).searchParams.get("action");
    if (action === "participant") {
      if (!event.is_test) return errorResponse("Test participants require a rehearsal event", 400);
      const payload = await readJson<{ firstName?: string; lastName?: string }>(request);
      const [participant] = await db.insert<{ id: string }>("participants", [{
        event_id: event.id, first_name: (payload.firstName || "Testa").slice(0, 100),
        last_name: (payload.lastName || "Dalībnieks").slice(0, 100),
        email: `${crypto.randomUUID()}@example.invalid`, status: "approved", access_mode: "full",
      }]);
      const passToken = createToken();
      const qrToken = createToken();
      const pepper = requiredEnv("TOKEN_PEPPER");
      await db.insert("participant_tokens", [
        { participant_id: participant.id, purpose: "magic_link", token_hash: await hashToken(passToken, pepper), expires_at: addDays(new Date(), 7) },
        { participant_id: participant.id, purpose: "qr_checkin", token_hash: await hashToken(qrToken, pepper), expires_at: addDays(new Date(), 7) },
      ]);
      await logAudit(db, actor, "rehearsal_participant_create", "participants", participant.id);
      return jsonResponse({ pass_token: passToken, qr_token: qrToken }, 201);
    }
    if (action !== "create") return errorResponse("Unsupported action", 400);
    const payload = await readJson<{ startsAt?: string }>(request);
    if (!payload.startsAt || !Number.isFinite(Date.parse(payload.startsAt))) return errorResponse("A valid rehearsal start is required", 400);
    const slug = `rehearsal-${crypto.randomUUID()}`;
    const id = await db.rpc<string>("create_event_rehearsal", { p_source_id: event.id, p_slug: slug, p_starts_at: payload.startsAt });
    await logAudit(db, actor, "rehearsal_create", "events", id, { source_id: event.id, slug, starts_at: payload.startsAt });
    return jsonResponse({ id, slug }, 201);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Rehearsal action failed", 500, String(error));
  }
});
