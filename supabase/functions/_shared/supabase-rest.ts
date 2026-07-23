import { requiredEnv } from "./http.ts";

type QueryValue = string | number | boolean | null | undefined;

export class SupabaseRest {
  private readonly url: string;
  private readonly serviceKey: string;

  constructor() {
    this.url = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
    this.serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  }

  async select<T>(table: string, query: Record<string, QueryValue> = {}): Promise<T[]> {
    const response = await this.request(table, {
      method: "GET",
      query: { select: "*", ...query },
    });
    return await response.json() as T[];
  }

  async insert<T>(table: string, rows: unknown[], query: Record<string, QueryValue> = {}): Promise<T[]> {
    const response = await this.request(table, {
      method: "POST",
      query,
      body: rows,
      headers: { Prefer: "return=representation" },
    });
    return await response.json() as T[];
  }

  async upsert<T>(table: string, rows: unknown[], onConflict: string): Promise<T[]> {
    const response = await this.request(table, {
      method: "POST",
      query: { on_conflict: onConflict },
      body: rows,
      headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    });
    return await response.json() as T[];
  }

  async update<T>(
    table: string,
    row: Record<string, unknown>,
    query: Record<string, QueryValue> = {},
  ): Promise<T[]> {
    const response = await this.request(table, {
      method: "PATCH",
      query,
      body: row,
      headers: { Prefer: "return=representation" },
    });
    return await response.json() as T[];
  }

  private async request(table: string, options: {
    method: string;
    query?: Record<string, QueryValue>;
    body?: unknown;
    headers?: Record<string, string>;
  }): Promise<Response> {
    const url = new URL(`${this.url}/rest/v1/${table}`);
    Object.entries(options.query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });

    const response = await fetch(url, {
      method: options.method,
      headers: {
        apikey: this.serviceKey,
        Authorization: `Bearer ${this.serviceKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase REST ${options.method} ${table} failed: ${response.status} ${text}`);
    }
    return response;
  }
}
