with event_row as (
  select id
  from events
  where slug = 'ai-reality-check-2026'
  limit 1
),
seed_items(starts_at, ends_at, title, description, speaker_name, speaker_company, status, is_break, display_order) as (
  values
    ('2026-09-30 09:00:00+03'::timestamptz, '2026-09-30 09:40:00+03'::timestamptz, 'Atklāšana', 'Pozīvisms vs realitāte AI nozarē', 'Betija Deina Muižniece', 'ANIMAS', 'now'::agenda_status, false, 10),
    ('2026-09-30 09:40:00+03'::timestamptz, '2026-09-30 10:00:00+03'::timestamptz, 'Mākslīgā intelekta nozīme Latvijas konkurētspējai', 'Par to, kā MI var būt Latvijas konkurētspējas dzinējspēks globālajā ekonomikā.', 'Valdis Melderis', null, 'next'::agenda_status, false, 20),
    ('2026-09-30 10:00:00+03'::timestamptz, '2026-09-30 10:20:00+03'::timestamptz, 'MI bankās — ikdiena un prasības', 'Praktiska pieredze par mākslīgā intelekta ieviešanu CSDD – izvēlētie risinājumi, gūtie rezultāti, izaicinājumi un secinājumi.', 'Lilita Beķere', 'Valsts kanceleja', 'later'::agenda_status, false, 30),
    ('2026-09-30 10:20:00+03'::timestamptz, '2026-09-30 10:40:00+03'::timestamptz, 'No stratēģijas līdz vērtībai: mākslīgais intelekts valsts pārvaldē', 'Par valsts redzējumu, prioritātēm un nākamajiem soļiem, lai mākslīgais intelekts kļūtu par Latvijas izaugsmes dzinējspēku.', 'Gatis Ozols', 'VARAM', 'later'::agenda_status, false, 40),
    ('2026-09-30 10:40:00+03'::timestamptz, '2026-09-30 11:00:00+03'::timestamptz, 'Ko nevar digitalizēt – to var automatizēt', 'Kā roboti, viedās tehnoloģijas un citas inovācijas maina sūtījuma ceļu no nosūtītāja līdz saņēmējam.', 'Jānis Grants', 'DPD Latvija', 'later'::agenda_status, false, 50),
    ('2026-09-30 11:00:00+03'::timestamptz, '2026-09-30 11:20:00+03'::timestamptz, 'No paralēlām realitātēm uz kopīgu risinājumu', 'Mākslīgā intelekta loma Latvijas ekonomikā – kas to vieno un kā veidot kopīgu nākotni?', 'Guna Pūce', 'Mākslīgā intelekta centrs', 'later'::agenda_status, false, 60),
    ('2026-09-30 11:20:00+03'::timestamptz, '2026-09-30 11:40:00+03'::timestamptz, 'Datu modeļu nozīme MI labam darbam', 'Datu kvalitāte un modeļu nozīme mākslīgā intelekta efektīvumam.', 'Lilita Beķere', 'Valsts kanceleja', 'later'::agenda_status, false, 70),
    ('2026-09-30 12:00:00+03'::timestamptz, '2026-09-30 13:00:00+03'::timestamptz, 'Pusdienas', 'Rīgas Motormuzeja kafejnīca · 1. stāvs · Networking', null, null, 'break'::agenda_status, true, 80),
    ('2026-09-30 13:00:00+03'::timestamptz, '2026-09-30 13:20:00+03'::timestamptz, 'Nozare PropTech nekustamo īpašumu tehnoloģijas un dati', 'Par to, kā tehnoloģijas un mākslīgais intelekts maina nekustamo īpašumu nozari — palīdz apkopot un analizēt datus, pamanīt riskus, precīzāk novērtēt īpašumus un pieņemt pamatotākus lēmumus. Tiks apskatītas arī datu kvalitātes problēmas, MI ierobežojumi un robeža starp tehnoloģiju ieteikumiem un profesionāļa atbildību.', 'Artūrs Kostins', 'Estimo.lv', 'later'::agenda_status, false, 90),
    ('2026-09-30 13:20:00+03'::timestamptz, '2026-09-30 13:40:00+03'::timestamptz, 'Mans produktīvākais kolēģis ir mākslīgais intelekts', 'Praktiskas stāstu krājums par MI integrāciju darbā un tā ietekmi uz produktivitāti.', 'Betija Deina Muižniece', 'ANIMAS', 'later'::agenda_status, false, 100),
    ('2026-09-30 13:40:00+03'::timestamptz, '2026-09-30 14:00:00+03'::timestamptz, 'SHIFT2 un Shipyard AI', 'Inovatīvi risinājumi un praktiski piemēri mākslīgā intelekta integrācijai industrijas procesiem.', 'Kristaps Cīrulis', 'SHIFT2 & Shipyard AI', 'later'::agenda_status, false, 110),
    ('2026-09-30 14:00:00+03'::timestamptz, '2026-09-30 14:15:00+03'::timestamptz, 'Kafijas pauze', 'Pauze pirms paneļdiskusijas.', null, null, 'break'::agenda_status, true, 120),
    ('2026-09-30 14:15:00+03'::timestamptz, '2026-09-30 15:00:00+03'::timestamptz, 'Paneļdiskusija', 'Diskusija par MI nākotnē un tās lomu Latvijā.', 'Valdis Melderis', null, 'later'::agenda_status, false, 130)
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
