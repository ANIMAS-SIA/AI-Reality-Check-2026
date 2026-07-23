import { errorResponse, handleOptions, jsonResponse } from "../_shared/http.ts";
import { SupabaseRest } from "../_shared/supabase-rest.ts";

type EventRow = { id: string; slug: string; name: string };
type PollRow = { id: string; event_id: string; title: string; status: string; results_public: boolean };
type PollOptionRow = { id: string; poll_id: string; label: string; display_order: number };
type PollVoteRow = { id: string; poll_id: string; option_id: string; company_snapshot: Record<string, unknown> };
type CompanyRow = { id: string; industry: string | null; company_size_badge: string | null; region: string | null };
type ParticipantRow = { id: string; company_id: string | null; ai_stage: string | null };

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
    const companies: CompanyRow[] = [];
    for (const id of companyIds) {
      const company = (await db.select<CompanyRow>("companies", { id: `eq.${id}`, limit: 1 }))[0];
      if (company) companies.push(company);
    }

    const usingAiCount = participants.filter((p) => p.ai_stage && p.ai_stage !== "Vēl neizmantojam").length;
    const usingAiPercent = participants.length ? Math.round((usingAiCount / participants.length) * 100) : 0;

    return jsonResponse({
      event,
      summary: {
        participant_count: participants.length,
        represented_companies: companyIds.length,
        using_ai_percent: usingAiPercent,
        headline: participants.length
          ? `${usingAiPercent}% reģistrēto dalībnieku pārstāvēto uzņēmumu MI jau izmanto vai testē.`
          : "Rezultāti tiks publicēti pēc pirmajām atbildēm.",
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
