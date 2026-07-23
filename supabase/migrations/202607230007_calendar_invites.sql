alter table events
  add column if not exists graph_calendar_user text,
  add column if not exists microsoft_graph_event_id text;

create table if not exists calendar_invites (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  participant_id uuid references participants(id) on delete set null,
  provider text not null default 'microsoft_graph',
  status text not null default 'queued' check (status in ('queued', 'sent', 'skipped', 'failed')),
  sent_to text not null,
  external_event_id text,
  provider_response jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_calendar_invites_participant
  on calendar_invites(participant_id, created_at desc);

create index if not exists idx_calendar_invites_event
  on calendar_invites(event_id, created_at desc);

update events
set graph_calendar_user = coalesce(graph_calendar_user, 'konference@animas.lv')
where slug = 'ai-reality-check-2026';
