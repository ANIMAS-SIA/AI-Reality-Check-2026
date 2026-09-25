-- Optional, agenda-driven poll activation. Existing polls remain manual.
alter table public.polls
  add column auto_activate_with_agenda boolean not null default false;

-- At most one poll may be prepared for automatic activation per agenda item.
-- Archived polls no longer reserve the slot.
create unique index polls_one_auto_activation_per_agenda
  on public.polls (event_id, agenda_item_id)
  where auto_activate_with_agenda = true
    and agenda_item_id is not null
    and status <> 'archived';

-- The marker makes reconciliation edge-triggered and idempotent: an agenda
-- item is processed once, so manually closing its poll does not reopen it.
create table public.event_poll_automation_state (
  event_id uuid primary key references public.events(id) on delete cascade,
  agenda_item_id uuid references public.agenda_items(id) on delete set null,
  active_poll_id uuid references public.polls(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.event_poll_automation_state enable row level security;

create function public.reconcile_event_poll_automation(p_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_event public.events%rowtype;
  automation public.event_poll_automation_state%rowtype;
  current_agenda_id uuid;
  target_poll_id uuid;
  previous_poll_id uuid;
begin
  -- Serialize all schedule/manual transitions for one event.
  select * into strict selected_event
  from public.events
  where id = p_event_id
  for update;

  insert into public.event_poll_automation_state (event_id)
  values (selected_event.id)
  on conflict (event_id) do nothing;

  select * into strict automation
  from public.event_poll_automation_state
  where event_id = selected_event.id
  for update;

  if selected_event.agenda_mode = 'manual' then
    select item.id into current_agenda_id
    from public.agenda_items item
    where item.id = selected_event.current_agenda_item_id
      and item.event_id = selected_event.id
      and item.status <> 'cancelled';
  else
    select item.id into current_agenda_id
    from public.agenda_items item
    where item.event_id = selected_event.id
      and item.status <> 'cancelled'
      and item.starts_at <= clock_timestamp()
      and item.ends_at > clock_timestamp()
    order by item.display_order asc, item.starts_at asc
    limit 1;
  end if;

  if automation.agenda_item_id is not distinct from current_agenda_id then
    return jsonb_build_object(
      'changed', false,
      'agenda_item_id', current_agenda_id,
      'poll_id', automation.active_poll_id
    );
  end if;

  previous_poll_id := automation.active_poll_id;
  if previous_poll_id is not null then
    update public.polls
    set status = 'closed',
        closed_at = coalesce(closed_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where id = previous_poll_id
      and event_id = selected_event.id
      and status = 'active';
  end if;

  if current_agenda_id is not null then
    select poll.id into target_poll_id
    from public.polls poll
    where poll.event_id = selected_event.id
      and poll.agenda_item_id = current_agenda_id
      and poll.auto_activate_with_agenda = true
      and poll.status <> 'archived'
      and (
        poll.poll_type not in ('single_choice', 'multiple_choice', 'scale')
        or 2 <= (
          select count(*)
          from public.poll_options option
          where option.poll_id = poll.id
        )
      )
    order by poll.created_at asc
    limit 1;
  end if;

  if target_poll_id is not null then
    -- Preserve the global one-active-poll invariant before opening the target.
    update public.polls
    set status = 'closed',
        closed_at = coalesce(closed_at, clock_timestamp()),
        updated_at = clock_timestamp()
    where event_id = selected_event.id
      and status = 'active'
      and id <> target_poll_id;

    update public.polls
    set status = 'active',
        activated_at = clock_timestamp(),
        closed_at = null,
        updated_at = clock_timestamp()
    where id = target_poll_id;

    insert into public.presentation_state (
      event_id, mode, agenda_item_id, poll_id, question_id, updated_at
    ) values (
      selected_event.id, 'poll_question', current_agenda_id, target_poll_id, null, clock_timestamp()
    )
    on conflict (event_id) do update
      set mode = 'poll_question',
          agenda_item_id = excluded.agenda_item_id,
          poll_id = excluded.poll_id,
          question_id = null,
          updated_by = null,
          updated_at = excluded.updated_at;
  elsif previous_poll_id is not null then
    -- Only replace a projector screen still owned by the previous automatic
    -- poll. A moderator's later announcement/question choice is preserved.
    update public.presentation_state
    set mode = case
          when current_agenda_id is null then 'waiting'::public.presentation_mode
          else 'agenda'::public.presentation_mode
        end,
        agenda_item_id = current_agenda_id,
        poll_id = null,
        question_id = null,
        updated_by = null,
        updated_at = clock_timestamp()
    where event_id = selected_event.id
      and poll_id = previous_poll_id
      and mode in ('poll_question', 'poll_results');
  end if;

  update public.event_poll_automation_state
  set agenda_item_id = current_agenda_id,
      active_poll_id = target_poll_id,
      updated_at = clock_timestamp()
  where event_id = selected_event.id;

  return jsonb_build_object(
    'changed', true,
    'agenda_item_id', current_agenda_id,
    'poll_id', target_poll_id,
    'previous_poll_id', previous_poll_id
  );
end;
$$;

revoke all on function public.reconcile_event_poll_automation(uuid) from public, anon, authenticated;
grant execute on function public.reconcile_event_poll_automation(uuid) to service_role;
