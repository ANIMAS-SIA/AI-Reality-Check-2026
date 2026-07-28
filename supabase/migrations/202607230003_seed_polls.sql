with event_row as (
  select id
  from events
  where slug = 'ai-reality-check-2026'
  limit 1
),
agenda as (
  select id, title
  from agenda_items
  where event_id = (select id from event_row)
),
poll_seed(title, agenda_title, status, results_public, display_order, options) as (
  values
    (
      'Kurā stadijā jūsu uzņēmums pašlaik ir ar MI ieviešanu?',
      'MI industrijas iekšējais skatījums',
      'active'::poll_status,
      true,
      10,
      array['Vēl neizmantojam', 'Izmēģinām atsevišķus rīkus', 'Izmantojam vairākos procesos', 'MI ir daļa no uzņēmuma stratēģijas']
    ),
    (
      'Kur MI šobrīd dod lielāko praktisko ieguvumu?',
      'MI industrijas iekšējais skatījums',
      'draft'::poll_status,
      false,
      20,
      array['Klientu apkalpošanā', 'Dokumentu apstrādē', 'Pārdošanā', 'Finanšu procesos', 'Ražošanā un loģistikā', 'Vadības lēmumu pieņemšanā']
    ),
    (
      'Kas ir lielākais MI ieviešanas risks?',
      'Paneļdiskusija',
      'draft'::poll_status,
      false,
      30,
      array['Datu drošība', 'Nepareizi rezultāti', 'Darbinieku pretestība', 'Pārmērīgas izmaksas', 'Atkarība no tehnoloģiju piegādātājiem', 'Regulējums']
    ),
    (
      'Kas notiks ar uzņēmumiem, kuri tuvāko divu gadu laikā MI neieviesīs?',
      'Paneļdiskusija',
      'draft'::poll_status,
      false,
      40,
      array['Būtiski zaudēs konkurētspēju', 'Atpaliks tikai atsevišķos procesos', 'Nekas būtisks nemainīsies', 'Tas ir atkarīgs no nozares']
    ),
    (
      'Vai pēc šīs konferences plānojat aktīvāk ieviest MI savā uzņēmumā?',
      'Paneļdiskusija',
      'draft'::poll_status,
      false,
      50,
      array['Jā, tuvāko trīs mēnešu laikā', 'Jā, bet vispirms jāizvērtē iespējas', 'Vēl neesmu pārliecināts', 'Nē']
    )
),
inserted_polls as (
  insert into polls (event_id, agenda_item_id, title, status, results_public, allow_anonymous, activated_at)
  select
    event_row.id,
    agenda.id,
    poll_seed.title,
    poll_seed.status,
    poll_seed.results_public,
    true,
    case when poll_seed.status = 'active' then now() else null end
  from event_row
  join poll_seed on true
  left join agenda on agenda.title = poll_seed.agenda_title
  where not exists (
    select 1
    from polls existing
    where existing.event_id = event_row.id
      and existing.title = poll_seed.title
  )
  returning id, title
)
insert into poll_options (poll_id, label, display_order)
select
  polls.id,
  option_label,
  option_index
from polls
join poll_seed on poll_seed.title = polls.title
cross join unnest(poll_seed.options) with ordinality as option_rows(option_label, option_index)
where polls.event_id = (select id from event_row)
  and not exists (
    select 1
    from poll_options existing
    where existing.poll_id = polls.id
      and existing.label = option_label
  );
