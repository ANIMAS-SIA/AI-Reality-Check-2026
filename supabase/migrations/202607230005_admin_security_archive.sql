create table if not exists admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete set null,
  actor_key_hash text,
  action text not null,
  target_table text,
  target_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public_rate_limits (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  ip_hash text not null,
  hits integer not null default 1,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bucket, ip_hash)
);

create index if not exists idx_admin_audit_logs_event_time on admin_audit_logs(event_id, created_at desc);
create index if not exists idx_public_rate_limits_bucket on public_rate_limits(bucket, updated_at desc);
create index if not exists idx_contact_requests_recipient on contact_requests(recipient_id, status, created_at desc);
create index if not exists idx_networking_profiles_visible on networking_profiles(is_visible, updated_at desc);

alter table admin_audit_logs enable row level security;
alter table public_rate_limits enable row level security;
