import { errorResponse } from "./http.ts";
import { SupabaseRest } from "./supabase-rest.ts";

type RateRow = {
  id: string;
  hits: number;
  window_started_at: string;
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function rateLimit(db: SupabaseRest, request: Request, bucket: string, maxHits = 30, windowSeconds = 60): Promise<Response | null> {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("cf-connecting-ip")
    || "unknown";
  const ipHash = await sha256(`${bucket}:${ip}:${Deno.env.get("TOKEN_PEPPER") || ""}`);
  const rows = await db.select<RateRow>("public_rate_limits", {
    bucket: `eq.${bucket}`,
    ip_hash: `eq.${ipHash}`,
    limit: 1,
  });
  const now = new Date();
  const existing = rows[0];
  if (!existing) {
    await db.insert("public_rate_limits", [{ bucket, ip_hash: ipHash, hits: 1, window_started_at: now.toISOString() }]);
    return null;
  }
  const windowStarted = new Date(existing.window_started_at).getTime();
  if (now.getTime() - windowStarted > windowSeconds * 1000) {
    await db.update("public_rate_limits", { hits: 1, window_started_at: now.toISOString() }, { id: `eq.${existing.id}` });
    return null;
  }
  if (existing.hits >= maxHits) return errorResponse("Too many requests", 429);
  await db.update("public_rate_limits", { hits: existing.hits + 1 }, { id: `eq.${existing.id}` });
  return null;
}
