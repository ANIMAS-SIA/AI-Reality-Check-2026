-- Admin platform: real auth + roles, presentation control, richer poll types.

-- Extend existing enums (kept separate from any INSERT/UPDATE using the new
-- values further down, since ALTER TYPE ... ADD VALUE cannot be used in the
-- same transaction as a statement that references the new value).
alter type agenda_status add value if not exists 'cancelled';
alter type question_status add value if not exists 'rejected';
alter type question_status add value if not exists 'highlighted';
alter type question_status add value if not exists 'shown_on_screen';
alter type question_status add value if not exists 'archived';
alter type poll_status add value if not exists 'ready';
alter type poll_status add value if not exists 'paused';
alter type poll_status add value if not exists 'archived';

create type admin_role as enum (
  'superadmin',
  'organizer',
  'moderator',
  'viewer',
  'screen'
);

create type poll_type as enum (
  'single_choice',
  'multiple_choice',
  'scale',
  'yes_no',
  'open_text',
  'word_cloud'
);

create type presentation_mode as enum (
  'waiting',
  'agenda',
  'poll_question',
  'poll_results',
  'questions',
  'announcement',
  'results',
  'closing'
);

-- Admin users --------------------------------------------------------------

create table admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role admin_role not null default 'viewer',
  display_name text,
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_admin_profiles_role on admin_profiles(role, status);

-- Presentation control -------------------------------------------------------

create table presentation_state (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null unique references events(id) on delete cascade,
  mode presentation_mode not null default 'waiting',
  agenda_item_id uuid references agenda_items(id) on delete set null,
  poll_id uuid references polls(id) on delete set null,
  question_id uuid references questions(id) on delete set null,
  results_visible boolean not null default false,
  qr_visible boolean not null default true,
  announcement_text text,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table presentation_links (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  token_hash text not null unique,
  label text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_presentation_links_event on presentation_links(event_id, revoked_at);

-- Program: category + per-item question toggle ------------------------------

alter table agenda_items
  add column category text,
  add column questions_enabled boolean not null default true;

-- Questions: merge tracking ---------------------------------------------------

alter table questions
  add column merged_into_id uuid references questions(id) on delete set null;

create index idx_questions_merged_into on questions(merged_into_id);

-- Polls: type + rich settings -------------------------------------------------

alter table polls
  add column poll_type poll_type not null default 'single_choice',
  add column settings jsonb not null default '{}'::jsonb;

-- Allow one vote row per selected option (multiple_choice) instead of a single
-- row per participant per poll. Single/scale/yes_no polls still only ever
-- insert one row per participant — that's enforced in the polls function, not
-- the schema — so this loosening is additive and doesn't change their behavior.
alter table poll_votes drop constraint poll_votes_poll_id_participant_id_key;
alter table poll_votes drop constraint poll_votes_poll_id_anonymous_session_id_key;
alter table poll_votes add constraint poll_votes_poll_participant_option_key unique (poll_id, participant_id, option_id);
alter table poll_votes add constraint poll_votes_poll_anon_option_key unique (poll_id, anonymous_session_id, option_id);

create table poll_text_responses (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  anonymous_session_id text,
  response_text text not null check (char_length(response_text) between 1 and 280),
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  check (participant_id is not null or anonymous_session_id is not null)
);

create index idx_poll_text_responses_poll on poll_text_responses(poll_id, created_at desc);

-- Audit log: attribute to a real user, not just a hashed shared key ---------

alter table admin_audit_logs
  add column actor_user_id uuid references auth.users(id) on delete set null;

create index idx_admin_audit_logs_actor on admin_audit_logs(actor_user_id, created_at desc);

-- Triggers -------------------------------------------------------------------

create trigger touch_admin_profiles_updated_at before update on admin_profiles for each row execute function touch_updated_at();

-- RLS: enabled, no policies — all access goes through service-role edge
-- functions that check admin_profiles.role themselves (see _shared/auth.ts).

alter table admin_profiles enable row level security;
alter table presentation_state enable row level security;
alter table presentation_links enable row level security;
alter table poll_text_responses enable row level security;
