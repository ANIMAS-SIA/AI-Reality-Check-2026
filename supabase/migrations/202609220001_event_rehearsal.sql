-- Additive migration: existing event and participant data are preserved.
alter table public.events
  add column agenda_mode text not null default 'schedule' check (agenda_mode in ('schedule', 'manual')),
  add column is_test boolean not null default false;
alter table public.agenda_items
  add column planned_starts_at timestamptz,
  add column planned_ends_at timestamptz,
  add column actual_started_at timestamptz;
update public.agenda_items set planned_starts_at = starts_at, planned_ends_at = ends_at;
alter table public.analytics_events add column event_id uuid references public.events(id);
update public.analytics_events set event_id = (select id from public.events where slug = 'ai-reality-check-2026');
update public.admin_audit_logs set event_id = (select id from public.events where slug = 'ai-reality-check-2026') where event_id is null;

-- Indexable event scopes on child records. Old writers remain compatible: the
-- trigger derives the event from the parent when event_id is omitted.
create function public.inherit_parent_event() returns trigger language plpgsql set search_path = public as $$
declare parent_event uuid; parent_id uuid;
begin
  parent_id := (to_jsonb(new) ->> tg_argv[0])::uuid;
  if parent_id is not null then
    execute format('select event_id from public.%I where id = $1', tg_argv[1]) into strict parent_event using parent_id;
    if new.event_id is not null and new.event_id <> parent_event then raise exception 'Cross-event child reference'; end if;
    new.event_id := parent_event;
  end if;
  return new;
end $$;
do $$
declare mapping text[];
begin
  foreach mapping slice 1 in array array[
    ['participant_tokens','participant_id','participants'], ['consents','participant_id','participants'],
    ['wallet_passes','participant_id','participants'], ['email_deliveries','participant_id','participants'],
    ['networking_profiles','participant_id','participants'], ['calendar_invites','participant_id','participants'],
    ['poll_options','poll_id','polls'], ['poll_votes','poll_id','polls'],
    ['poll_text_responses','poll_id','polls'], ['question_votes','question_id','questions']
  ] loop
    execute format('alter table public.%I add column if not exists event_id uuid references public.events(id)', mapping[1]);
    execute format('update public.%I c set event_id = p.event_id from public.%I p where p.id = c.%I', mapping[1], mapping[3], mapping[2]);
    execute format('create index %I on public.%I(event_id)', 'idx_' || mapping[1] || '_event_scope', mapping[1]);
    execute format('create trigger inherit_parent_event before insert or update on public.%I for each row execute function public.inherit_parent_event(%L, %L)', mapping[1], mapping[2], mapping[3]);
  end loop;
end $$;

create function public.capture_agenda_plan() returns trigger language plpgsql as $$
begin
  new.planned_starts_at := coalesce(new.planned_starts_at, new.starts_at);
  new.planned_ends_at := coalesce(new.planned_ends_at, new.ends_at);
  return new;
end $$;
create trigger capture_agenda_plan before insert on public.agenda_items
  for each row execute function public.capture_agenda_plan();

-- A single transaction/row lock serializes manual control and schedule shifts.
create function public.control_event_agenda(p_event_id uuid, p_action text, p_item_id uuid default null, p_minutes integer default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare e events; chosen agenda_items; cutoff integer; changed integer := 0;
begin
  select * into strict e from events where id = p_event_id for update;
  if p_action = 'manual' then
    select * into strict chosen from agenda_items where id = p_item_id and event_id = e.id and status <> 'cancelled';
    update agenda_items set actual_started_at = coalesce(actual_started_at, clock_timestamp()) where id = chosen.id;
    update events set agenda_mode = 'manual', current_agenda_item_id = chosen.id where id = e.id;
  elsif p_action = 'schedule' then
    update events set agenda_mode = 'schedule', current_agenda_item_id = null where id = e.id;
  elsif p_action = 'shift' then
    if p_minutes is null or p_minutes = 0 or abs(p_minutes) > 1440 then raise exception 'Minutes must be between -1440 and 1440, excluding zero'; end if;
    if p_item_id is not null then
      select * into strict chosen from agenda_items where id = p_item_id and event_id = e.id and status <> 'cancelled';
      cutoff := chosen.display_order;
    end if;
    update agenda_items set starts_at = starts_at + make_interval(mins => p_minutes), ends_at = ends_at + make_interval(mins => p_minutes)
      where event_id = e.id and status <> 'cancelled'
      and (case when cutoff is not null then display_order > cutoff else starts_at > now() end);
    get diagnostics changed = row_count;
  else raise exception 'Unsupported agenda action'; end if;
  return jsonb_build_object('ok', true, 'changed', changed);
end $$;
revoke all on function public.control_event_agenda(uuid,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.control_event_agenda(uuid,text,uuid,integer) to service_role;

-- Clone only content, never real participants, answers, tokens or check-ins.
create function public.create_event_rehearsal(p_source_id uuid, p_slug text, p_starts_at timestamptz)
returns uuid language plpgsql security invoker set search_path = public as $$
declare source events; target events; item agenda_items; item_copy agenda_items;
  poll polls; poll_copy polls; opt poll_options; opt_copy poll_options;
  agenda_map jsonb := '{}'::jsonb; delta interval;
begin
  select * into strict source from events where id = p_source_id;
  if p_starts_at is null or p_slug !~ '^rehearsal-[a-z0-9-]{1,60}$' then raise exception 'Invalid rehearsal settings'; end if;
  -- Seconds, not calendar days: preserve all offsets across DST boundaries too.
  delta := make_interval(secs => extract(epoch from (p_starts_at - source.starts_at))::double precision);
  target := source;
  target.id := gen_random_uuid(); target.slug := p_slug; target.name := source.name || ' — mēģinājums';
  target.starts_at := p_starts_at; target.ends_at := source.ends_at + delta;
  target.is_test := true; target.agenda_mode := 'schedule'; target.current_agenda_item_id := null;
  target.created_at := now(); target.updated_at := now();
  -- Never inherit the real calendar invitation or automatic admission settings.
  target.microsoft_graph_event_id := null; target.graph_calendar_user := null;
  target.auto_approve_enabled := false;
  insert into events select (target).*;
  for item in select * from agenda_items where event_id = source.id loop
    item_copy := item; item_copy.id := gen_random_uuid(); item_copy.event_id := target.id;
    item_copy.starts_at := item.starts_at + delta; item_copy.ends_at := item.ends_at + delta;
    item_copy.planned_starts_at := item_copy.starts_at; item_copy.planned_ends_at := item_copy.ends_at;
    item_copy.actual_started_at := null;
    item_copy.status := case when item.status = 'cancelled' then 'cancelled'::agenda_status when item.is_break then 'break'::agenda_status else 'later'::agenda_status end;
    item_copy.created_at := now(); item_copy.updated_at := now();
    insert into agenda_items select (item_copy).*;
    agenda_map := agenda_map || jsonb_build_object(item.id::text, item_copy.id::text);
  end loop;
  for poll in select * from polls where event_id = source.id loop
    poll_copy := poll; poll_copy.id := gen_random_uuid(); poll_copy.event_id := target.id;
    poll_copy.agenda_item_id := (agenda_map ->> poll.agenda_item_id::text)::uuid;
    poll_copy.status := 'draft'; poll_copy.results_public := false;
    poll_copy.activated_at := null; poll_copy.closed_at := null;
    poll_copy.created_at := now(); poll_copy.updated_at := now();
    insert into polls select (poll_copy).*;
    for opt in select * from poll_options where poll_id = poll.id loop
      opt_copy := opt; opt_copy.id := gen_random_uuid(); opt_copy.poll_id := poll_copy.id; opt_copy.event_id := target.id; opt_copy.created_at := now();
      insert into poll_options select (opt_copy).*;
    end loop;
  end loop;
  return target.id;
end $$;
revoke all on function public.create_event_rehearsal(uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.create_event_rehearsal(uuid,text,timestamptz) to service_role;
