-- Run ONLY against a disposable local database after all migrations. Always rolls back.
begin;
do $$
declare source events; trial events; trial_id uuid; first_item agenda_items; last_item agenda_items;
  before_event jsonb; before_agenda jsonb; before_polls jsonb; control jsonb; count_before integer;
begin
  select * into strict source from events where slug = 'ai-reality-check-2026';
  before_event := to_jsonb(source);
  select jsonb_agg(to_jsonb(a) order by id) into before_agenda from agenda_items a where event_id = source.id;
  select jsonb_agg(to_jsonb(p) order by id) into before_polls from polls p where event_id = source.id;
  trial_id := create_event_rehearsal(source.id, 'rehearsal-local-test', '2026-09-22T10:00:00+03');
  select * into strict trial from events where id = trial_id;
  assert trial.is_test and trial.agenda_mode = 'schedule' and trial.current_agenda_item_id is null;
  assert trial.starts_at = '2026-09-22T07:00:00Z'::timestamptz;
  assert trial.ends_at - trial.starts_at = source.ends_at - source.starts_at;
  assert (select count(*) from agenda_items where event_id = trial_id) = (select count(*) from agenda_items where event_id = source.id);
  assert not exists (select 1 from agenda_items a join agenda_items b on b.event_id = source.id and b.display_order = a.display_order where a.event_id = trial_id and
    (a.starts_at - trial.starts_at <> b.starts_at - source.starts_at or a.ends_at - a.starts_at <> b.ends_at - b.starts_at or a.is_break <> b.is_break));
  assert not exists (select 1 from participants where event_id = trial_id);
  assert not exists (select 1 from polls where event_id = trial_id and (status <> 'draft' or results_public));
  assert not exists (select 1 from polls p join agenda_items a on a.id = p.agenda_item_id where p.event_id = trial_id and a.event_id <> trial_id);
  assert (select count(*) from poll_options o join polls p on p.id = o.poll_id where p.event_id = trial_id) =
    (select count(*) from poll_options o join polls p on p.id = o.poll_id where p.event_id = source.id);
  select * into strict first_item from agenda_items where event_id = trial_id order by display_order limit 1;
  select * into strict last_item from agenda_items where event_id = trial_id order by display_order desc limit 1;
  perform control_event_agenda(trial_id, 'manual', first_item.id);
  assert (select agenda_mode from events where id = trial_id) = 'manual';
  assert (select current_agenda_item_id from events where id = trial_id) = first_item.id;
  assert (select actual_started_at is not null and starts_at = first_item.starts_at from agenda_items where id = first_item.id);
  select count(*) into count_before from agenda_items where event_id = trial_id and display_order > first_item.display_order and status <> 'cancelled';
  control := control_event_agenda(trial_id, 'shift', first_item.id, 7);
  assert (control ->> 'changed')::integer = count_before;
  assert (select starts_at = last_item.starts_at + interval '7 minutes' and planned_starts_at = last_item.planned_starts_at from agenda_items where id = last_item.id);
  assert (select starts_at = first_item.starts_at from agenda_items where id = first_item.id);
  perform control_event_agenda(trial_id, 'schedule');
  assert (select agenda_mode = 'schedule' and current_agenda_item_id is null from events where id = trial_id);
  begin
    perform control_event_agenda(trial_id, 'manual', (select id from agenda_items where event_id = source.id limit 1));
    raise exception 'Cross-event item was accepted';
  exception when no_data_found then null;
  end;
  assert before_event = (select to_jsonb(e) from events e where id = source.id), 'Production event changed';
  assert before_agenda = (select jsonb_agg(to_jsonb(a) order by id) from agenda_items a where event_id = source.id), 'Production agenda changed';
  assert before_polls = (select jsonb_agg(to_jsonb(p) order by id) from polls p where event_id = source.id), 'Production polls changed';
  assert not has_function_privilege('anon', 'control_event_agenda(uuid,text,uuid,integer)', 'EXECUTE');
  assert not has_function_privilege('authenticated', 'create_event_rehearsal(uuid,text,timestamptz)', 'EXECUTE');
  raise notice 'Rehearsal isolation, timing, manual control, shift and privileges passed';
end $$;
rollback;
