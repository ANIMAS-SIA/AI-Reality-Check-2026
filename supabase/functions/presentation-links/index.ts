import { AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";
import { addDays, createToken, hashToken } from "../_shared/tokens.ts";

type EventRow = { id: string; slug: string };
type LinkRow = {
  id: string;
  event_id: string;
  label: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function listLinks(db: SupabaseRest, eventId: string): Promise<Response> {
  const links = await db.select<LinkRow>("presentation_links", {
    event_id: `eq.${eventId}`,
    select: "id,event_id,label,expires_at,revoked_at,created_at",
    order: "created_at.desc",
  });
  return jsonResponse({ links });
}

async function createLink(db: SupabaseRest, actorId: string, event: EventRow, label: string, ttlDays: number): Promise<Response> {
  const token = createToken();
  const inserted = await db.insert<LinkRow>("presentation_links", [{
    event_id: event.id,
    token_hash: await hashToken(token, requiredEnv("TOKEN_PEPPER")),
    label: label.trim() || null,
    expires_at: addDays(new Date(), ttlDays),
    created_by: actorId,
  }]);
  return jsonResponse({ link: inserted[0], token }, 201);
}

async function revokeLink(db: SupabaseRest, linkId: string): Promise<Response> {
  const updated = await db.update<LinkRow>("presentation_links", { revoked_at: new Date().toISOString() }, { id: `eq.${linkId}` });
  if (!updated[0]) return errorResponse("Link not found", 404);
  return jsonResponse({ link: updated[0] });
}

async function verifyLink(db: SupabaseRest, token: string): Promise<Response> {
  if (!token) return errorResponse("Token is required", 400);
  const tokenHash = await hashToken(token, requiredEnv("TOKEN_PEPPER"));
  const link = (await db.select<LinkRow>("presentation_links", {
    token_hash: `eq.${tokenHash}`,
    revoked_at: "is.null",
    limit: 1,
  }))[0];
  if (!link) return jsonResponse({ valid: false });
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) return jsonResponse({ valid: false });
  return jsonResponse({ valid: true, label: link.label });
}

const MANAGE_ROLES = ["superadmin"] as const;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.searchParams.get("action") === "verify") {
        return await verifyLink(db, (url.searchParams.get("token") || "").trim());
      }
      await authenticateAdmin(request, db, [...MANAGE_ROLES]);
      const event = await getEvent(db);
      return await listLinks(db, event.id);
    }

    if (request.method === "POST") {
      const actor = await authenticateAdmin(request, db, [...MANAGE_ROLES]);
      const action = url.searchParams.get("action") || "create";
      if (action === "create") {
        const event = await getEvent(db);
        const payload = await readJson<{ label?: string; ttlDays?: number }>(request);
        const response = await createLink(db, actor.userId, event, payload.label || "", Number(payload.ttlDays) || 1);
        await logAudit(db, actor, "presentation_link_create", "presentation_links", undefined, { label: payload.label });
        return response;
      }
      const linkId = url.searchParams.get("link_id") || "";
      if (action === "revoke" && linkId) {
        const response = await revokeLink(db, linkId);
        await logAudit(db, actor, "presentation_link_revoke", "presentation_links", linkId);
        return response;
      }
      return errorResponse("Unsupported action", 400);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Presentation links failed", 500, String(error));
  }
});
