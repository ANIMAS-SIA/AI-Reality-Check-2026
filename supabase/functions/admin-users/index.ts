import { AdminActor, AdminAuthError, adminAuthErrorResponse, authenticateAdmin, logAudit } from "../_shared/auth.ts";
import { errorResponse, handleOptions, jsonResponse, readJson, requiredEnv } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

const ROLES = ["superadmin", "organizer", "moderator", "viewer", "screen"] as const;
type Role = typeof ROLES[number];

type ProfileRow = {
  user_id: string;
  role: Role;
  display_name: string | null;
  status: string;
  created_at: string;
};

type GoTrueUser = { id: string; email?: string; last_sign_in_at?: string | null };

function authHeaders(): Record<string, string> {
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": "application/json" };
}

async function goTrue(path: string, init: RequestInit = {}): Promise<Response> {
  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  return await fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init.headers || {}) },
  });
}

async function listUsers(db: SupabaseRest): Promise<Response> {
  const profiles = await db.select<ProfileRow>("admin_profiles", { order: "created_at.asc" });
  const response = await goTrue("/admin/users?per_page=200");
  const data = await response.json().catch(() => ({ users: [] }));
  const users: GoTrueUser[] = data.users || [];
  const byId = new Map(users.map((user) => [user.id, user]));

  return jsonResponse({
    users: profiles.map((profile) => ({
      ...profile,
      email: byId.get(profile.user_id)?.email || null,
      last_sign_in_at: byId.get(profile.user_id)?.last_sign_in_at || null,
    })),
  });
}

async function findUserByEmail(email: string): Promise<GoTrueUser | null> {
  const response = await goTrue("/admin/users?per_page=1000");
  const data = await response.json().catch(() => ({ users: [] }));
  if (!response.ok) throw new Error(data.msg || data.message || "Neizdevās pārbaudīt esošos lietotājus.");
  return (data.users || []).find((user: GoTrueUser) => user.email?.toLowerCase() === email) || null;
}

async function saveAdminProfile(db: SupabaseRest, userId: string, role: Role, displayName: string): Promise<void> {
  await db.upsert("admin_profiles", [{
    user_id: userId,
    role,
    display_name: displayName.trim() || null,
    status: "active",
  }], "user_id");
  await goTrue(`/admin/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify({ ban_duration: "none" }),
  });
}

async function inviteUser(db: SupabaseRest, actor: AdminActor, email: string, role: Role, displayName: string): Promise<Response> {
  if (!email.trim()) return errorResponse("Email is required", 400);
  if (!ROLES.includes(role)) return errorResponse("Unsupported role", 400);

  const normalizedEmail = email.trim().toLowerCase();
  const redirectTo = Deno.env.get("ADMIN_REDIRECT_URL") || "https://konference.animas.lv/admin/";
  const existingUser = await findUserByEmail(normalizedEmail);
  if (existingUser) {
    const recoveryResponse = await goTrue(`/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
      method: "POST",
      body: JSON.stringify({ email: normalizedEmail }),
    });
    const recoveryData = await recoveryResponse.json().catch(() => ({}));
    if (!recoveryResponse.ok) {
      return errorResponse(recoveryData.msg || recoveryData.message || "Neizdevās atkārtoti nosūtīt piekļuves saiti.", recoveryResponse.status);
    }
    await saveAdminProfile(db, existingUser.id, role, displayName);
    await logAudit(db, actor, "admin_user_access_resent", "admin_profiles", existingUser.id, {
      email: normalizedEmail,
      role,
      redirect_to: redirectTo,
    });
    return jsonResponse({ ok: true, user_id: existingUser.id, resent: true });
  }

  const response = await goTrue(`/invite?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    body: JSON.stringify({ email: normalizedEmail }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return errorResponse(data.msg || data.message || "Neizdevās uzaicināt lietotāju.", response.status);

  const userId = data.id || data.user?.id;
  if (!userId) return errorResponse("GoTrue did not return a user id", 500);

  await saveAdminProfile(db, userId, role, displayName);

  await logAudit(db, actor, "admin_user_invite", "admin_profiles", userId, { email: normalizedEmail, role, redirect_to: redirectTo });
  return jsonResponse({ ok: true, user_id: userId }, 201);
}

async function setRole(db: SupabaseRest, targetUserId: string, role: Role): Promise<Response> {
  if (!ROLES.includes(role)) return errorResponse("Unsupported role", 400);
  const updated = await db.update<ProfileRow>("admin_profiles", { role }, { user_id: `eq.${targetUserId}` });
  if (!updated[0]) return errorResponse("Admin profile not found", 404);
  return jsonResponse({ profile: updated[0] });
}

async function setStatus(db: SupabaseRest, targetUserId: string, status: "active" | "disabled"): Promise<Response> {
  const updated = await db.update<ProfileRow>("admin_profiles", { status }, { user_id: `eq.${targetUserId}` });
  if (!updated[0]) return errorResponse("Admin profile not found", 404);
  // Belt-and-braces: also block the session at the auth layer, not just our own role check.
  await goTrue(`/admin/users/${targetUserId}`, {
    method: "PUT",
    body: JSON.stringify({ ban_duration: status === "disabled" ? "87600h" : "none" }),
  }).catch(() => null);
  return jsonResponse({ profile: updated[0] });
}

const SUPERADMIN_ONLY = ["superadmin"] as const;

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;

  try {
    const db = new SupabaseRest();
    const url = new URL(request.url);

    if (request.method === "GET") {
      if (url.searchParams.get("action") === "whoami") {
        const actor = await authenticateAdmin(request, db, [...ROLES]);
        return jsonResponse({ user_id: actor.userId, email: actor.email, role: actor.role, display_name: actor.displayName });
      }
      await authenticateAdmin(request, db, [...SUPERADMIN_ONLY]);
      return await listUsers(db);
    }

    if (request.method === "POST") {
      const actor = await authenticateAdmin(request, db, [...SUPERADMIN_ONLY]);
      const action = url.searchParams.get("action");
      const targetUserId = url.searchParams.get("user_id") || "";

      if (action === "invite") {
        const payload = await readJson<{ email?: string; role?: Role; displayName?: string }>(request);
        return await inviteUser(db, actor, payload.email || "", payload.role || "viewer", payload.displayName || "");
      }
      if (action === "set-role" && targetUserId) {
        const payload = await readJson<{ role?: Role }>(request);
        const response = await setRole(db, targetUserId, payload.role || "viewer");
        await logAudit(db, actor, "admin_user_role", "admin_profiles", targetUserId, { role: payload.role });
        return response;
      }
      if (action === "set-status" && targetUserId) {
        const payload = await readJson<{ status?: "active" | "disabled" }>(request);
        const response = await setStatus(db, targetUserId, payload.status === "disabled" ? "disabled" : "active");
        await logAudit(db, actor, "admin_user_status", "admin_profiles", targetUserId, { status: payload.status });
        return response;
      }
      return errorResponse("Unsupported action", 400);
    }

    return errorResponse("Method not allowed", 405);
  } catch (error) {
    if (error instanceof AdminAuthError) return adminAuthErrorResponse(error);
    return errorResponse("Admin users failed", 500, String(error));
  }
});
