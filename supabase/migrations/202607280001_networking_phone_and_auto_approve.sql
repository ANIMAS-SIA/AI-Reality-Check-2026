alter table networking_profiles
  add column if not exists phone text;

alter table events
  alter column auto_approve_enabled set default true;

update events set auto_approve_enabled = true where auto_approve_enabled = false;
