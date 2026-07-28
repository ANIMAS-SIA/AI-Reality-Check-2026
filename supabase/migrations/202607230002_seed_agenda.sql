with event_row as (
  select id
  from events
  where slug = 'ai-reality-check-2026'
  limit 1
),
seed_items(starts_at, ends_at, title, description, speaker_name, speaker_company, status, is_break, display_order) as (
  values
    ('2026-09-30 09:40:00+03'::timestamptz, '2026-09-30 10:00:00+03'::timestamptz, 'MI industrijas iekšējais skatījums', 'Kā uzņēmumiem saprast, kur MI dod reālu atdevi un kur sākas troksnis.', 'Betija Deina Muižniece', 'ANIMAS', 'now'::agenda_status, false, 10),
    ('2026-09-30 10:00:00+03'::timestamptz, '2026-09-30 10:20:00+03'::timestamptz, 'Valsts nostāja MI - stratēģija un mērķi', 'Stratēģija, mērķi un regulējums.', null, null, 'next'::agenda_status, false, 20),
    ('2026-09-30 10:20:00+03'::timestamptz, '2026-09-30 10:40:00+03'::timestamptz, 'Kafijas pauze', 'Pauze un networking.', null, null, 'break'::agenda_status, true, 30),
    ('2026-09-30 10:40:00+03'::timestamptz, '2026-09-30 11:00:00+03'::timestamptz, 'Sūtījumu automatizācija un robotizācija', 'Praktisks loģistikas piemērs.', null, null, 'later'::agenda_status, false, 40),
    ('2026-09-30 11:00:00+03'::timestamptz, '2026-09-30 11:20:00+03'::timestamptz, 'Kāpēc MI ieviešana ir vadības izaicinājums', 'Vadības lēmumi, atbildība un ieviešanas temps.', null, null, 'later'::agenda_status, false, 50),
    ('2026-09-30 12:00:00+03'::timestamptz, '2026-09-30 13:00:00+03'::timestamptz, 'Pusdienas', 'Pusdienas un sarunas.', null, null, 'break'::agenda_status, true, 60),
    ('2026-09-30 13:00:00+03'::timestamptz, '2026-09-30 13:20:00+03'::timestamptz, 'Estimo platforma un AI projekti', 'FinTech piemēri un praktiska ieviešana.', 'Artūrs Kostins', 'Estimo', 'later'::agenda_status, false, 70),
    ('2026-09-30 13:20:00+03'::timestamptz, '2026-09-30 13:40:00+03'::timestamptz, 'AI pasaulē - nākotnes virziens', 'Globālais skatījums uz MI nākotni.', 'Kristaps Cīrulis', null, 'later'::agenda_status, false, 80),
    ('2026-09-30 14:00:00+03'::timestamptz, '2026-09-30 14:15:00+03'::timestamptz, 'Kafijas pauze', 'Pauze pirms paneļdiskusijas.', null, null, 'break'::agenda_status, true, 90),
    ('2026-09-30 14:15:00+03'::timestamptz, '2026-09-30 15:00:00+03'::timestamptz, 'Paneļdiskusija', 'Kas notiek, ja MI neievieš?', 'Valdis Melderis', null, 'later'::agenda_status, false, 100)
)
insert into agenda_items (
  event_id,
  starts_at,
  ends_at,
  title,
  description,
  speaker_name,
  speaker_company,
  status,
  is_break,
  display_order
)
select
  event_row.id,
  seed_items.starts_at,
  seed_items.ends_at,
  seed_items.title,
  seed_items.description,
  seed_items.speaker_name,
  seed_items.speaker_company,
  seed_items.status,
  seed_items.is_break,
  seed_items.display_order
from event_row, seed_items
where not exists (
  select 1
  from agenda_items existing
  where existing.event_id = event_row.id
    and existing.title = seed_items.title
    and existing.starts_at = seed_items.starts_at
);

update events
set current_agenda_item_id = (
  select agenda_items.id
  from agenda_items
  where agenda_items.event_id = events.id
    and agenda_items.status = 'now'
    and agenda_items.is_break = false
  order by agenda_items.starts_at
  limit 1
)
where slug = 'ai-reality-check-2026'
  and current_agenda_item_id is null;
