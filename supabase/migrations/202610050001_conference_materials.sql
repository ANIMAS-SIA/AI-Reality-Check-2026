-- One private, replaceable conference-material PDF per event.
-- Files live in Supabase Storage; this table owns their visibility and retention.
create table public.conference_materials (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null,
  mime_type text not null default 'application/pdf' check (mime_type = 'application/pdf'),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 52428800),
  published_at timestamptz,
  expires_at timestamptz not null default (now() + interval '2 hours'),
  deleted_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conference_materials_expiry_window
    check (expires_at <= coalesce(published_at, created_at) + interval '30 days 5 minutes')
);

create index conference_materials_current_idx
  on public.conference_materials(event_id, created_at desc)
  where deleted_at is null;

alter table public.conference_materials enable row level security;
revoke all on public.conference_materials from public, anon, authenticated;
grant all on public.conference_materials to service_role;

comment on table public.conference_materials is
  'Private conference PDFs. The conference-materials Edge Function is the only access layer.';

-- Supabase Storage does not support expiry of current objects. The Edge Function
-- removes them through the Storage API, as required by Supabase. This daily job
-- follows Supabase's documented pg_cron + pg_net + Vault pattern.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'arc-conference-materials-cleanup',
  '15 2 * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'arc_project_url'
        limit 1
      ) || '/functions/v1/conference-materials?action=cleanup',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'apikey', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'arc_publishable_key'
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    ) as request_id;
  $job$
);

