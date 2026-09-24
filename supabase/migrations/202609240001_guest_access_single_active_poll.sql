-- Allow optional display names for unregistered question authors.
alter table questions
  add column if not exists guest_name text
  check (guest_name is null or char_length(guest_name) between 1 and 80);

-- Preserve the most recently activated poll if legacy data contains more than
-- one active poll for the same event, then enforce the invariant in the DB.
with ranked_active as (
  select id,
         row_number() over (
           partition by event_id
           order by activated_at desc nulls last, created_at desc, id desc
         ) as position
  from polls
  where status = 'active'
)
update polls
set status = 'closed',
    closed_at = coalesce(closed_at, now()),
    updated_at = now()
where id in (select id from ranked_active where position > 1);

create unique index if not exists idx_polls_one_active_per_event
  on polls (event_id)
  where status = 'active';
