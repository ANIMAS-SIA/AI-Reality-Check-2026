import { errorResponse, requiredEnv } from "./http.ts";
import { SupabaseRest } from "./supabase-rest.ts";

export type AdminRole = "superadmin" | "organizer" | "moderator" | "viewer" | "screen";

export type AdminActor = {
  userId: string;
  email: string;
  role: AdminRole;
  displayName: string | null;
};

type AdminProfileRow = {
  user_id: string;
  role: AdminRole;
  display_name: string | null;
  status: string;
};

type GoTrueUser = { id: string; email?: string };

export class AdminAuthError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function resolveAuthUser(request: Request): Promise<GoTrueUser> {
  const authHeader = request.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new AdminAuthError("Missing Authorization header", 401);

  const supabaseUrl = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    },
  });
  if (!response.ok) throw new AdminAuthError("Invalid or expired session", 401);
  return await response.json() as GoTrueUser;
}

/** Validates the caller's Supabase Auth session and checks their admin_profiles role. */
export async function authenticateAdmin(
  request: Request,
  db: SupabaseRest,
  allowedRoles: AdminRole[],
): Promise<AdminActor> {
  const user = await resolveAuthUser(request);
  const profile = (await db.select<AdminProfileRow>("admin_profiles", {
    user_id: `eq.${user.id}`,
    limit: 1,
  }))[0];
  if (!profile) throw new AdminAuthError("No admin profile for this account", 403);
  if (profile.status !== "active") throw new AdminAuthError("Admin account is disabled", 403);
  if (!allowedRoles.includes(profile.role)) throw new AdminAuthError("Insufficient role", 403);

  return {
    userId: user.id,
    email: user.email || "",
    role: profile.role,
    displayName: profile.display_name,
  };
}

export function adminAuthErrorResponse(error: unknown): Response {
  if (error instanceof AdminAuthError) return errorResponse(error.message, error.status);
  console.error("Admin auth failed", error instanceof Error ? error.message : String(error));
  return errorResponse("Authentication failed", 401);
}

export async function logAudit(
  db: SupabaseRest,
  actor: AdminActor,
  action: string,
  targetTable?: string,
  targetId?: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await db.insert("admin_audit_logs", [{
    actor_user_id: actor.userId,
    action,
    target_table: targetTable || null,
    target_id: targetId || null,
    metadata: { actor_email: actor.email, actor_role: actor.role, ...metadata },
  }]);
}
