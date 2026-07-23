alter table events
  add column if not exists auto_approve_enabled boolean not null default false,
  add column if not exists auto_approve_limit integer not null default 0 check (auto_approve_limit >= 0);
