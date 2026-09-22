import { requiredEnv } from "./http.ts";

type QueryValue = string | number | boolean | null | undefined;

const EVENT_TABLES = new Set(["agenda_items", "participants", "questions", "polls", "checkins", "presentation_state", "presentation_links", "contact_requests", "analytics_events", "admin_audit_logs"]);
const PARENTS: Record<string, [string, string]> = {
  participant_tokens: ["participant_id", "participants"], consents: ["participant_id", "participants"],
  wallet_passes: ["participant_id", "participants"], email_deliveries: ["participant_id", "participants"],
  networking_profiles: ["participant_id", "participants"], calendar_invites: ["participant_id", "participants"],
  poll_options: ["poll_id", "polls"], poll_votes: ["poll_id", "polls"],
  poll_text_responses: ["poll_id", "polls"], question_votes: ["question_id", "questions"],
};
const REFERENCES: Record<string, string> = {
  agenda_item_id: "agenda_items", current_agenda_item_id: "agenda_items", participant_id: "participants",
  requester_id: "participants", recipient_id: "participants", question_id: "questions",
  merged_into_id: "questions", poll_id: "polls", option_id: "poll_options",
};
type ScopedEvent = { id: string; slug: string; is_test: boolean };

export class SupabaseRest {
  private readonly url: string;
  private readonly serviceKey: string;
  readonly eventSlug: string;
  get topic() { return `live:${this.eventSlug}`; }
  private eventPromise?: Promise<ScopedEvent>;

  constructor(request?: Request) {
    this.url = requiredEnv("SUPABASE_URL").replace(/\/$/, "");
    this.serviceKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
    this.eventSlug = (request && new URL(request.url).searchParams.get("event")) || Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
    if (!/^[a-z0-9-]{1,100}$/.test(this.eventSlug)) throw new Error("Invalid event slug");
  }

  event(): Promise<ScopedEvent> {
    return this.eventPromise ||= this.rawRequest("events", { method: "GET", query: { select: "id,slug,is_test", slug: `eq.${this.eventSlug}`, limit: 1 } })
      .then((response) => response.json()).then((rows) => {
        if (!rows[0]) throw new Error("Event not found");
        return rows[0];
      });
  }

  async rpc<T>(name: "control_event_agenda" | "create_event_rehearsal", args: Record<string, unknown>): Promise<T> {
    return await (await this.rawRequest(`rpc/${name}`, { method: "POST", body: args })).json() as T;
  }

  async assertRehearsalSafe(request: Request) {
    if (!(await this.event()).is_test) return;
    const url = new URL(request.url);
    const route = url.pathname.split("/").pop();
    const action = url.searchParams.get("action") || "";
    // Rehearsals exercise stage operations, not real email, Wallet or calendar integrations.
    if (route === "wallet" || route === "registrations"
      || (request.method !== "GET" && route === "admin-users")
      || (request.method !== "GET" && route === "participant-actions")
      || (request.method !== "GET" && route === "admin-registrations" && !["settings", "update", "revoke-tokens"].includes(action))) {
      throw new Error("Mēģinājumā e-pasti, kalendārs, Wallet un kopīgo administratoru izmaiņas ir atslēgtas.");
    }
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

  async delete<T>(table: string, query: Record<string, QueryValue>): Promise<T[]> {
    const response = await this.request(table, {
      method: "DELETE",
      query,
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
    const scoped = table === "events" || EVENT_TABLES.has(table) || table in PARENTS;
    if (scoped) {
      const event = await this.event();
      if (options.method !== "POST") {
        const filter = `${table === "events" ? "id" : "event_id"}.eq.${event.id}`;
        const query = { ...options.query };
        query.and = query.and ? `(${filter},and${query.and})` : `(${filter})`;
        options = { ...options, query };
      }
      if (options.body) {
        const rows = (Array.isArray(options.body) ? options.body : [options.body]) as Record<string, unknown>[];
        for (const row of rows) {
          if (row.event_id && row.event_id !== event.id) throw new Error("Cross-event write blocked");
          if (table === "events" && ((row.id && row.id !== event.id) || (row.slug && row.slug !== event.slug))) throw new Error("Event reassignment blocked");
          if (table !== "events" && options.method === "POST") row.event_id = event.id;
          for (const [column, parent] of Object.entries(REFERENCES)) {
            if (!row[column]) continue;
            const match = await this.select<{ id: string; poll_id?: string }>(parent, { id: `eq.${row[column]}`, limit: 1 });
            if (!match[0]) throw new Error(`Cross-event or missing ${column}`);
            if (column === "option_id" && row.poll_id && match[0].poll_id !== row.poll_id) throw new Error("Option does not belong to poll");
          }
        }
      }
    }
    return await this.rawRequest(table, options);
  }

  private async rawRequest(table: string, options: {
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
