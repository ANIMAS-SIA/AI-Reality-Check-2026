create extension if not exists pgcrypto;

create type registration_status as enum (
  'application_received',
  'approved',
  'waitlisted',
  'rejected',
  'cancelled',
  'reconfirm_required',
  'arrived',
  'no_show'
);

create type participant_access_mode as enum (
  'basic',
  'full',
  'anonymous'
);

create type agenda_status as enum (
  'done',
  'now',
  'next',
  'later',
  'break'
);

create type question_status as enum (
  'pending',
  'approved',
  'hidden',
  'answered',
  'moved_to_panel'
);

create type poll_status as enum (
  'draft',
  'active',
  'closed',
  'published'
);

create type email_delivery_status as enum (
  'queued',
  'sent',
  'failed',
  'opened',
  'clicked'
);

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  venue_name text,
  venue_address text,
  capacity integer not null default 100 check (capacity > 0),
  current_agenda_item_id uuid,
  archive_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table companies (
  id uuid primary key default gen_random_uuid(),
  c360_registration_number text unique,
  name text not null,
  country text not null default 'LV',
  status text,
  legal_form text,
  registered_date date,
  address text,
  legal_address text,
  nace_code text,
  industry text,
  nace_text text,
  company_size text,
  company_size_badge text,
  region text,
  sector_type text,
  logo_url text,
  c360_payload jsonb not null default '{}'::jsonb,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  company_id uuid references companies(id) on delete set null,
  first_name text not null,
  last_name text not null,
  email text not null,
  role text,
  status registration_status not null default 'application_received',
  access_mode participant_access_mode not null default 'basic',
  ai_stage text,
  ai_stage_is_anonymous boolean not null default false,
  public_company_allowed boolean not null default false,
  networking_allowed boolean not null default false,
  newsletter_allowed boolean not null default false,
  attendance_reconfirmed_at timestamptz,
  cancelled_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, email)
);

create table participant_tokens (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  token_hash text not null unique,
  purpose text not null check (purpose in ('magic_link', 'qr_checkin', 'wallet')),
  expires_at timestamptz,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table consents (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  consent_key text not null,
  granted boolean not null,
  source text not null default 'registration',
  created_at timestamptz not null default now(),
  unique (participant_id, consent_key)
);

create table agenda_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  title text not null,
  description text,
  speaker_name text,
  speaker_role text,
  speaker_company text,
  status agenda_status not null default 'later',
  is_break boolean not null default false,
  display_order integer not null default 0,
  materials_url text,
  video_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table events
  add constraint events_current_agenda_item_id_fkey
  foreign key (current_agenda_item_id) references agenda_items(id) on delete set null;

create table questions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  agenda_item_id uuid references agenda_items(id) on delete set null,
  participant_id uuid references participants(id) on delete set null,
  anonymous_session_id text,
  body text not null check (char_length(body) between 1 and 280),
  is_anonymous boolean not null default true,
  status question_status not null default 'pending',
  vote_count integer not null default 0,
  shown_on_screen_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (participant_id is not null or anonymous_session_id is not null)
);

create table question_votes (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  anonymous_session_id text,
  created_at timestamptz not null default now(),
  check (participant_id is not null or anonymous_session_id is not null),
  unique (question_id, participant_id),
  unique (question_id, anonymous_session_id)
);

create table polls (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  agenda_item_id uuid references agenda_items(id) on delete set null,
  title text not null,
  status poll_status not null default 'draft',
  allow_anonymous boolean not null default true,
  results_public boolean not null default false,
  activated_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  label text not null,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table poll_votes (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references polls(id) on delete cascade,
  option_id uuid not null references poll_options(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  anonymous_session_id text,
  is_anonymous boolean not null default true,
  company_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (participant_id is not null or anonymous_session_id is not null),
  unique (poll_id, participant_id),
  unique (poll_id, anonymous_session_id)
);

create table checkins (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  participant_id uuid not null references participants(id) on delete cascade,
  scanned_by uuid,
  scanned_at timestamptz not null default now(),
  scan_result text not null check (scan_result in ('accepted', 'duplicate', 'invalid_status')),
  device_label text,
  metadata jsonb not null default '{}'::jsonb
);

create table wallet_passes (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants(id) on delete cascade,
  provider text not null check (provider in ('apple', 'google')),
  external_id text,
  serial_number text,
  status text not null default 'created',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (participant_id, provider)
);

create table email_deliveries (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete set null,
  template_key text not null,
  provider text not null,
  provider_message_id text,
  status email_delivery_status not null default 'queued',
  subject text,
  sent_to text not null,
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table networking_profiles (
  id uuid primary key default gen_random_uuid(),
  participant_id uuid not null unique references participants(id) on delete cascade,
  is_visible boolean not null default false,
  wants_to_discuss text,
  can_offer text,
  looking_for text,
  accepts_contact_requests boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table contact_requests (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  requester_id uuid not null references participants(id) on delete cascade,
  recipient_id uuid not null references participants(id) on delete cascade,
  message text,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requester_id <> recipient_id),
  unique (requester_id, recipient_id)
);

create index idx_participants_event_status on participants(event_id, status);
create index idx_participants_company on participants(company_id);
create index idx_tokens_hash_purpose on participant_tokens(token_hash, purpose);
create index idx_agenda_event_time on agenda_items(event_id, starts_at);
create index idx_questions_event_status on questions(event_id, status, created_at desc);
create index idx_questions_agenda_votes on questions(agenda_item_id, vote_count desc);
create index idx_polls_event_status on polls(event_id, status);
create index idx_poll_votes_poll on poll_votes(poll_id);
create index idx_checkins_event_time on checkins(event_id, scanned_at desc);
create index idx_email_deliveries_participant on email_deliveries(participant_id, created_at desc);

create or replace function touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger touch_events_updated_at before update on events for each row execute function touch_updated_at();
create trigger touch_companies_updated_at before update on companies for each row execute function touch_updated_at();
create trigger touch_participants_updated_at before update on participants for each row execute function touch_updated_at();
create trigger touch_agenda_items_updated_at before update on agenda_items for each row execute function touch_updated_at();
create trigger touch_questions_updated_at before update on questions for each row execute function touch_updated_at();
create trigger touch_polls_updated_at before update on polls for each row execute function touch_updated_at();
create trigger touch_wallet_passes_updated_at before update on wallet_passes for each row execute function touch_updated_at();
create trigger touch_email_deliveries_updated_at before update on email_deliveries for each row execute function touch_updated_at();
create trigger touch_networking_profiles_updated_at before update on networking_profiles for each row execute function touch_updated_at();
create trigger touch_contact_requests_updated_at before update on contact_requests for each row execute function touch_updated_at();

create or replace function update_question_vote_count()
returns trigger as $$
begin
  if tg_op = 'INSERT' then
    update questions set vote_count = vote_count + 1 where id = new.question_id;
    return new;
  elsif tg_op = 'DELETE' then
    update questions set vote_count = greatest(vote_count - 1, 0) where id = old.question_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql;

create trigger question_vote_count_insert after insert on question_votes for each row execute function update_question_vote_count();
create trigger question_vote_count_delete after delete on question_votes for each row execute function update_question_vote_count();

alter table events enable row level security;
alter table companies enable row level security;
alter table participants enable row level security;
alter table participant_tokens enable row level security;
alter table consents enable row level security;
alter table agenda_items enable row level security;
alter table questions enable row level security;
alter table question_votes enable row level security;
alter table polls enable row level security;
alter table poll_options enable row level security;
alter table poll_votes enable row level security;
alter table checkins enable row level security;
alter table wallet_passes enable row level security;
alter table email_deliveries enable row level security;
alter table networking_profiles enable row level security;
alter table contact_requests enable row level security;

insert into events (slug, name, starts_at, ends_at, venue_name, venue_address, capacity)
values (
  'ai-reality-check-2026',
  'AI Reality Check 2026',
  '2026-09-30 09:00:00+03',
  '2026-09-30 15:00:00+03',
  'Rīgas Motormuzejs',
  'Sergeja Eizenšteina iela 6, Rīga',
  100
)
on conflict (slug) do nothing;
