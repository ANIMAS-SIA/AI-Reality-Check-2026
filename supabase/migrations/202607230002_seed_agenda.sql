with event_row as (
  select id
  from events
  where slug = 'ai-reality-check-2026'
  limit 1
),
seed_items(starts_at, ends_at, title, description, speaker_name, speaker_company, status, is_break, display_order) as (
  values
    ('2026-09-30 09:00:00+03'::timestamptz, '2026-09-30 09:30:00+03'::timestamptz, 'Reģistrācija', null, null, null, 'now'::agenda_status, true, 10),
    ('2026-09-30 09:30:00+03'::timestamptz, '2026-09-30 09:40:00+03'::timestamptz, 'Ievadvārdi', null, 'Gatis Romanovskis', null, 'next'::agenda_status, false, 20),
    ('2026-09-30 09:40:00+03'::timestamptz, '2026-09-30 10:00:00+03'::timestamptz, 'Mans produktīvākais kolēģis ir mākslīgais intelekts.', null, 'Betija Deina Muižniece', 'ANIMAS', 'later'::agenda_status, false, 30),
    ('2026-09-30 10:00:00+03'::timestamptz, '2026-09-30 10:20:00+03'::timestamptz, 'No stratēģijas līdz vērtībai: mākslīgais intelekts valsts pārvaldē', null, 'Gatis Ozols', 'VARAM', 'later'::agenda_status, false, 40),
    ('2026-09-30 10:20:00+03'::timestamptz, '2026-09-30 10:40:00+03'::timestamptz, 'Kafijas pauze', null, null, null, 'break'::agenda_status, true, 50),
    ('2026-09-30 10:40:00+03'::timestamptz, '2026-09-30 11:00:00+03'::timestamptz, 'Ko nevar digitalizēt – to var automatizēt', null, 'Jānis Grants', 'DPD Latvija', 'later'::agenda_status, false, 60),
    ('2026-09-30 11:00:00+03'::timestamptz, '2026-09-30 11:20:00+03'::timestamptz, 'Kāpēc MI ieviešana ir vadības izaicinājums, nevis IT projekts. Pieredze no trim Baltijas tirgiem.', null, 'Lilita Beķere', 'Numeri grupa', 'later'::agenda_status, false, 70),
    ('2026-09-30 11:20:00+03'::timestamptz, '2026-09-30 11:40:00+03'::timestamptz, 'CSDD ieviestie MI rīki, mūsu pieredze', null, 'Dace Benhena', 'CSDD', 'later'::agenda_status, false, 80),
    ('2026-09-30 12:00:00+03'::timestamptz, '2026-09-30 13:00:00+03'::timestamptz, 'Pusdienas', null, null, null, 'break'::agenda_status, true, 90),
    ('2026-09-30 13:00:00+03'::timestamptz, '2026-09-30 13:20:00+03'::timestamptz, 'Nozare PropTech nekustamo īpašumu tehnoloģijas un dati', null, 'Artūrs Kostins', 'Estimo.lv', 'later'::agenda_status, false, 100),
    ('2026-09-30 13:20:00+03'::timestamptz, '2026-09-30 13:40:00+03'::timestamptz, 'Kāpēc lielākā daļa AI iniciatīvu uzņēmumos neattaisno cerības.', null, 'Kristaps Cīrulis', 'SHIFT2 & Shipyard AI', 'later'::agenda_status, false, 110),
    ('2026-09-30 13:40:00+03'::timestamptz, '2026-09-30 14:00:00+03'::timestamptz, 'No paralēlām realitātēm uz kopīgu risinājumu', null, 'Guna Pūce', 'Mākslīgā intelekta centrs', 'later'::agenda_status, false, 120),
    ('2026-09-30 14:00:00+03'::timestamptz, '2026-09-30 14:15:00+03'::timestamptz, 'Kafijas pauze', null, null, null, 'break'::agenda_status, true, 130),
    ('2026-09-30 14:15:00+03'::timestamptz, '2026-09-30 15:00:00+03'::timestamptz, 'Paneļdiskusija', null, 'Valdis Melderis', null, 'later'::agenda_status, false, 140)
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
