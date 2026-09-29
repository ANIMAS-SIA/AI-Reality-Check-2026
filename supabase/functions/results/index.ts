import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type EventRow = { id: string; slug: string; name: string; is_test: boolean };
type PollRow = { id: string; event_id: string; title: string; status: string; results_public: boolean };
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string; company_snapshot: Record<string, unknown> };
type JsonRecord = Record<string, unknown>;
type CompanyRow = {
  id: string;
  name: string;
  country: string;
  c360_registration_number: string | null;
  industry: string | null;
  company_size: string | null;
  company_size_badge: string | null;
  region: string | null;
  status: string | null;
  legal_form: string | null;
  registered_date: string | null;
  legal_address: string | null;
  c360_payload: JsonRecord | null;
  synced_at: string | null;
};
type ParticipantRow = {
  id: string;
  company_id: string | null;
  ai_stage: string | null;
  ai_maturity_level: number | null;
  ai_maturity_phase: string | null;
};

type C360BulkResult = {
  regcode?: string;
  status?: string;
  company?: JsonRecord | null;
};

const FINANCIAL_PRIVACY_MIN = 3;
const c360Syncs = new Map<string, Promise<CompanyRow[]>>();

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = db.eventSlug;
  const event = (await db.select<EventRow>("events", { slug: `eq.${slug}`, limit: 1 }))[0];
  if (!event) throw new Error(`Event not found: ${slug}`);
  return event;
}

async function pollResult(db: SupabaseRest, poll: PollRow) {
  const options = await db.select<PollOptionRow>("poll_options", {
    poll_id: `eq.${poll.id}`,
    order: "display_order.asc",
  });
  const votes = await db.select<PollVoteRow>("poll_votes", { poll_id: `eq.${poll.id}` });
  const total = votes.length;
  const rows = options.map((option) => {
    const count = votes.filter((vote) => vote.option_id === option.id).length;
    return { ...option, votes: count, percent: total ? Math.round((count / total) * 100) : 0 };
  });
  const top = [...rows].sort((a, b) => b.votes - a.votes)[0] || null;
  return { poll, options: rows, total_votes: total, top };
}

function groupedCounts(values: string[]) {
  const counts = new Map<string, number>();
  values.filter(Boolean).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const parsed = numeric(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

function needsC360Details(company: CompanyRow): boolean {
  if (!company.c360_registration_number) return false;
  return !record(company.c360_payload)._results_sync;
}

async function syncC360Details(db: SupabaseRest, companies: CompanyRow[]): Promise<CompanyRow[]> {
  const apiKey = Deno.env.get("C360_API_KEY");
  const pending = companies.filter(needsC360Details);
  if (!apiKey || !pending.length) return companies;

  const apiBase = Deno.env.get("C360_API_BASE") || "https://api.company360.lv";
  const syncedAt = new Date().toISOString();
  // Process one API-sized batch per public request. This keeps the endpoint
  // responsive even if Company360 serializes or throttles concurrent batches.
  const batch = pending.slice(0, 20);
  let results: C360BulkResult[] = [];
  try {
    const response = await fetch(new URL("/v1/company/bulk", apiBase), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      signal: AbortSignal.timeout(8_000),
      body: JSON.stringify({
        companies: batch.map((company) => company.c360_registration_number),
        country: "LV",
        fields: ["basic", "financials", "employees", "financials_history"],
      }),
    });
    if (response.ok) {
      const data = await response.json();
      results = Array.isArray(data?.results) ? data.results as C360BulkResult[] : [];
    }
  } catch {
    results = [];
  }

  const resultByRegcode = new Map(
    results.filter((item) => item.regcode).map((item) => [String(item.regcode), item]),
  );
  const updates = pending.flatMap((company) => {
    const result = resultByRegcode.get(company.c360_registration_number || "");
    if (!result) return [];
    const detail = record(result.company);
    const payload = {
      ...record(company.c360_payload),
      ...detail,
      _results_sync: { status: result.status || "unknown", synced_at: syncedAt },
    };
    return [{
      id: company.id,
      name: String(detail.name || company.name),
      country: String(detail.country || company.country || "LV"),
      c360_registration_number: company.c360_registration_number,
      status: detail.status ? String(detail.status) : company.status,
      legal_form: detail.legal_form ? String(detail.legal_form) : company.legal_form,
      registered_date: detail.registered_date ? String(detail.registered_date) : company.registered_date,
      legal_address: detail.legal_address ? String(detail.legal_address) : company.legal_address,
      company_size: detail.company_size ? String(detail.company_size) : company.company_size,
      company_size_badge: detail.company_size_badge ? String(detail.company_size_badge) : company.company_size_badge,
      region: detail.region ? String(detail.region) : company.region,
      industry: company.industry,
      c360_payload: payload,
      synced_at: syncedAt,
    }];
  });

  if (!updates.length) return companies;
  const mergedById = new Map(updates.map((company) => [company.id, company as CompanyRow]));
  try {
    const updated = await db.upsert<CompanyRow>("companies", updates, "id");
    updated.forEach((company) => mergedById.set(company.id, company));
  } catch {
    // Company360 enrichments are helpful, but must never make public results unavailable.
  }
  return companies.map((company) => mergedById.get(company.id) || company);
}

async function syncC360DetailsOnce(db: SupabaseRest, companies: CompanyRow[]): Promise<CompanyRow[]> {
  const current = c360Syncs.get(db.eventSlug);
  if (current) return await current;
  const pending = syncC360Details(db, companies);
  c360Syncs.set(db.eventSlug, pending);
  try {
    return await pending;
  } finally {
    c360Syncs.delete(db.eventSlug);
  }
}

function companyFinancials(companies: CompanyRow[]) {
  const rows = companies.map((company) => {
    const payload = record(company.c360_payload);
    const financials = record(payload.financials);
    const employees = record(payload.employees);
    return {
      eligible: Boolean(company.c360_registration_number),
      synced: Boolean(payload._results_sync),
      year: numeric(financials.year),
      turnover: firstNumber(financials.net_turnover, financials.revenue),
      profit: firstNumber(financials.net_profit_or_loss, financials.profit_loss),
      assets: numeric(financials.total_assets),
      equity: numeric(financials.equity),
      employees: firstNumber(employees.employee_count, financials.staff),
      salary: numeric(employees.avg_gross_salary),
    };
  });
  const metric = (key: keyof typeof rows[number]) => rows
    .map((row) => typeof row[key] === "number" ? row[key] as number : null)
    .filter((value): value is number => value !== null);
  const safeSum = (values: number[]) => values.length >= FINANCIAL_PRIVACY_MIN
    ? Math.round(values.reduce((sum, value) => sum + value, 0))
    : null;
  const turnovers = metric("turnover");
  const profits = metric("profit");
  const assets = metric("assets");
  const equities = metric("equity");
  const employeeCounts = metric("employees");
  const salaryRows = rows.filter((row) => row.salary !== null && row.employees !== null && row.employees > 0);
  const salaryEmployeeCount = salaryRows.reduce((sum, row) => sum + (row.employees || 0), 0);
  const weightedSalary = salaryRows.length >= FINANCIAL_PRIVACY_MIN && salaryEmployeeCount
    ? Math.round(salaryRows.reduce((sum, row) => sum + (row.salary || 0) * (row.employees || 0), 0) / salaryEmployeeCount)
    : null;
  const years = metric("year");
  const yearCounts = new Map<number, number>();
  years.forEach((year) => yearCounts.set(year, (yearCounts.get(year) || 0) + 1));
  const dataYear = [...yearCounts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] || null;

  return {
    company_count: companies.length,
    eligible_company_count: rows.filter((row) => row.eligible).length,
    enriched_company_count: rows.filter((row) => row.synced).length,
    financial_company_count: rows.filter((row) => row.turnover !== null || row.profit !== null || row.assets !== null).length,
    turnover_company_count: turnovers.length,
    profit_company_count: profits.length,
    asset_company_count: assets.length,
    equity_company_count: equities.length,
    employee_company_count: employeeCounts.length,
    salary_company_count: salaryRows.length,
    data_year: dataYear,
    total_turnover: safeSum(turnovers),
    median_turnover: turnovers.length >= FINANCIAL_PRIVACY_MIN ? median(turnovers) : null,
    total_profit: safeSum(profits),
    profitable_percent: profits.length >= FINANCIAL_PRIVACY_MIN
      ? Math.round((profits.filter((value) => value > 0).length / profits.length) * 100)
      : null,
    total_assets: safeSum(assets),
    total_equity: safeSum(equities),
    total_employees: safeSum(employeeCounts),
    weighted_avg_salary: weightedSalary,
    privacy_minimum: FINANCIAL_PRIVACY_MIN,
  };
}

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    const db = new SupabaseRest(request);
    await db.assertRehearsalSafe(request);
    const event = await getEvent(db);
    const polls = await db.select<PollRow>("polls", {
      event_id: `eq.${event.id}`,
      results_public: "eq.true",
      order: "created_at.asc",
    });
    const pollResults = [];
    for (const poll of polls) pollResults.push(await pollResult(db, poll));

    const participants = await db.select<ParticipantRow>("participants", {
      event_id: `eq.${event.id}`,
      status: "in.(approved,arrived,reconfirm_required)",
    });
    const companyIds = [...new Set(
      participants.map((p) => p.company_id).filter((id): id is string => Boolean(id)),
    )];
    let companies = companyIds.length
      ? await db.select<CompanyRow>("companies", { id: `in.(${companyIds.join(",")})` })
      : [];
    if (!event.is_test) companies = await syncC360DetailsOnce(db, companies);
    const companyById = new Map(companies.map((company) => [company.id, company]));

    const levels = participants.map((p) => p.ai_maturity_level).filter((level): level is number => Number.isInteger(level));
    const averageLevel = levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0;

    // "Using AI" = level 3+ (beyond pure exploration) on the new scale, or any
    // non-"not yet" answer on the old scale for rows that predate it.
    const usingAiCount = participants.filter((p) => (
      p.ai_maturity_level ? p.ai_maturity_level >= 3 : Boolean(p.ai_stage && p.ai_stage !== "Vēl neizmantojam")
    )).length;
    const usingAiPercentRounded = participants.length ? Math.round((usingAiCount / participants.length) * 100) : 0;
    const notUsingCount = participants.filter((p) => (
      p.ai_maturity_level ? p.ai_maturity_level === 1 : p.ai_stage === "Vēl neizmantojam"
    )).length;
    const notUsingPercent = participants.length ? Math.round((notUsingCount / participants.length) * 100) : 0;
    const maturityScore = levels.length ? Math.round(averageLevel * 10) : 0;

    const byLevel = Array.from({ length: 10 }, (_, index) => ({
      level: index + 1,
      count: levels.filter((level) => level === index + 1).length,
    }));
    const byPhase = groupedCounts(participants.map((p) => p.ai_maturity_phase || ""));
    const byIndustry = groupedCounts(participants.map((p) => (p.company_id ? companyById.get(p.company_id)?.industry || "" : "")));
    const bySize = groupedCounts(participants.map((p) => (p.company_id ? companyById.get(p.company_id)?.company_size_badge || "" : "")));

    return jsonResponse({
      event,
      summary: {
        participant_count: participants.length,
        represented_companies: companyIds.length,
        maturity_score: maturityScore,
        using_ai_percent: usingAiPercentRounded,
        not_using_ai_percent: notUsingPercent,
        headline: participants.length
          ? `${maturityScore}/100 ir konferences auditorijas MI gatavības indekss.`
          : "Rezultāti tiks publicēti pēc pirmajām atbildēm.",
      },
      maturity: {
        average: Math.round(averageLevel * 10) / 10,
        median: median(levels),
        answered_count: levels.length,
        by_level: byLevel,
        by_phase: byPhase,
        by_industry: byIndustry,
        by_size: bySize,
      },
      polls: pollResults,
      company_segments: {
        industries: groupedCounts(companies.map((company) => company.industry || "")),
        sizes: groupedCounts(companies.map((company) => company.company_size_badge || "")),
        regions: groupedCounts(companies.map((company) => company.region || "")),
      },
      company_financials: companyFinancials(companies),
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse("Results failed", 500, String(error));
  }
});
