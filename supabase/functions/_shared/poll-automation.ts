import { broadcast } from "./broadcast.ts";
import { SupabaseRest } from "./supabase-rest.ts";

export type PollAutomationResult = {
  changed: boolean;
  agenda_item_id: string | null;
  poll_id: string | null;
  previous_poll_id?: string | null;
};

export async function reconcilePollAutomation(db: SupabaseRest, eventId: string): Promise<PollAutomationResult> {
  const result = await db.rpc<PollAutomationResult>("reconcile_event_poll_automation", { p_event_id: eventId });
  if (result.changed) {
    try {
      await broadcast(db.topic, "state_changed", {
        action: "poll_automation",
        agenda_item_id: result.agenda_item_id,
        poll_id: result.poll_id,
      });
    } catch (error) {
      // The database transition has already committed. Polling clients will
      // recover the state, so a Realtime outage must not turn a successful
      // activation into a failed live-state/presentation request.
      console.warn("Poll automation broadcast failed", error);
    }
  }
  return result;
}
