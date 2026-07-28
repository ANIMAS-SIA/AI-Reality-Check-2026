import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type EventRow = { id: string; slug: string; name: string };
type PollRow = { id: string; event_id: string; title: string; status: string; results_public: boolean };
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string; company_snapshot: Record<string, unknown> };
type CompanyRow = { id: string; industry: string | null; company_size_badge: string | null; region: string | null };
type ParticipantRow = {
  id: string;
  company_id: string | null;
  ai_stage: string | null;
  ai_maturity_level: number | null;
  ai_maturity_phase: string | null;
};

async function getEvent(db: SupabaseRest): Promise<EventRow> {
  const slug = Deno.env.get("EVENT_SLUG") || "ai-reality-check-2026";
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

Deno.serve(async (request) => {
  const options = handleOptions(request);
  if (options) return options;
  if (request.method !== "GET") return errorResponse("Method not allowed", 405);

  try {
    const db = new SupabaseRest();
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
    const companyIds = [...new Set(participants.map((p) => p.company_id).filter(Boolean))];
    const companyById = new Map<string, CompanyRow>();
    for (const id of companyIds) {
      const company = (await db.select<CompanyRow>("companies", { id: `eq.${id}`, limit: 1 }))[0];
      if (company) companyById.set(id as string, company);
    }
    const companies = [...companyById.values()];

    const levels = participants.map((p) => p.ai_maturity_level).filter((level): level is number => Number.isInteger(level));
    const averageLevel = levels.length ? levels.reduce((sum, level) => sum + level, 0) / levels.length : 0;

    // "Using AI" = level 3+ (beyond pure exploration) on the new scale, or any
    // non-"not yet" answer on the old scale for rows that predate it.
    const usingAiCount = participants.filter((p) => (
      p.ai_maturity_level ? p.ai_maturity_level >= 3 : Boolean(p.ai_stage && p.ai_stage !== "Vēl neizmantojam")
    )).length;
    const usingAiPercentRounded = participants.length ? Math.round((usingAiCount / participants.length) * 100) : 0;

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
        using_ai_percent: usingAiPercentRounded,
        headline: participants.length
          ? `${usingAiPercentRounded}% reģistrēto dalībnieku pārstāvēto uzņēmumu MI jau izmanto vai testē.`
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
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse("Results failed", 500, String(error));
  }
});
