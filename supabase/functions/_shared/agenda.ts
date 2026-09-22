// One server-clock resolver for public Live, administration and question defaults.
export type AgendaControl = {
  agenda_mode?: string;
  current_agenda_item_id?: string | null;
};
export type TimedAgenda = {
  id: string;
  starts_at: string;
  ends_at?: string;
  status: string;
};

export function resolveAgenda<T extends TimedAgenda>(event: AgendaControl, items: T[], now = Date.now()) {
  const available = items.filter((item) => item.status !== "cancelled");
  const current = event.agenda_mode === "manual"
    ? available.find((item) => item.id === event.current_agenda_item_id) || null
    : available.find((item) => Date.parse(item.starts_at) <= now && Date.parse(item.ends_at || "") > now) || null;
  const currentIndex = current ? available.indexOf(current) : -1;
  const next = current
    ? available[currentIndex + 1] || null
    : available.find((item) => Date.parse(item.starts_at) > now) || null;
  const agenda = items.map((item) => ({
    ...item,
    status: item.status === "cancelled" ? "cancelled"
      : item.id === current?.id ? "now"
      : item.id === next?.id ? "next"
      : (event.agenda_mode === "manual" && current
        ? available.indexOf(item) < currentIndex
        : Date.parse(item.ends_at || "") <= now) ? "done" : "later",
  }));
  return { current, next, agenda };
}
