-- Interactive AI maturity scale (1-10) for registration step 2, replacing the
-- old 4-option ai_stage question. ai_stage/ai_stage_is_anonymous are kept
-- untouched for historical rows — new registrations write the fields below.

alter table participants
  add column ai_maturity_level integer check (ai_maturity_level between 1 and 10),
  add column ai_maturity_phase text,
  add column ai_maturity_anonymous boolean not null default true,
  add column ai_maturity_answered_at timestamptz,
  add column ai_maturity_version integer not null default 1;

create index idx_participants_maturity_level on participants(ai_maturity_level);

-- Lightweight first-party analytics sink for the maturity step interactions.
-- Deliberately holds no participant/session identifiers — only the event
-- name and the small properties payload described in the spec.

create table analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_analytics_events_name_time on analytics_events(event_name, created_at desc);

alter table analytics_events enable row level security;
