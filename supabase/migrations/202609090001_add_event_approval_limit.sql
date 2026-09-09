alter table public.events
  add column if not exists approval_limit integer;

update public.events
set approval_limit = capacity
where approval_limit is null;

alter table public.events
  alter column approval_limit set default 100,
  alter column approval_limit set not null;

alter table public.events
  add constraint events_approval_limit_positive check (approval_limit > 0);
