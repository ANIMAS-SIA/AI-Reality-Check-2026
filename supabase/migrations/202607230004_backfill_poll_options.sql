with option_seed(title, display_order, label) as (
  values
    ('Kurā stadijā jūsu uzņēmums pašlaik ir ar MI ieviešanu?', 1, 'Vēl neizmantojam'),
    ('Kurā stadijā jūsu uzņēmums pašlaik ir ar MI ieviešanu?', 2, 'Izmēģinām atsevišķus rīkus'),
    ('Kurā stadijā jūsu uzņēmums pašlaik ir ar MI ieviešanu?', 3, 'Izmantojam vairākos procesos'),
    ('Kurā stadijā jūsu uzņēmums pašlaik ir ar MI ieviešanu?', 4, 'MI ir daļa no uzņēmuma stratēģijas'),
    ('Kur MI šobrīd dod lielāko praktisko ieguvumu?', 1, 'Klientu apkalpošanā'),
    ('Kur MI šobrīd dod lielāko praktisko ieguvumu?', 2, 'Dokumentu apstrādē'),
    ('Kur MI šobrīd dod lielāko praktisko ieguvumu?', 3, 'Pārdošanā'),
    ('Kur MI šobrīd dod lielāko praktisko ieguvumu?', 4, 'Finanšu procesos'),
    ('Kur MI šobrīd dod lielāko praktisko ieguvumu?', 5, 'Ražošanā un loģistikā'),
    ('Kur MI šobrīd dod lielāko praktisko ieguvumu?', 6, 'Vadības lēmumu pieņemšanā'),
    ('Kas ir lielākais MI ieviešanas risks?', 1, 'Datu drošība'),
    ('Kas ir lielākais MI ieviešanas risks?', 2, 'Nepareizi rezultāti'),
    ('Kas ir lielākais MI ieviešanas risks?', 3, 'Darbinieku pretestība'),
    ('Kas ir lielākais MI ieviešanas risks?', 4, 'Pārmērīgas izmaksas'),
    ('Kas ir lielākais MI ieviešanas risks?', 5, 'Atkarība no tehnoloģiju piegādātājiem'),
    ('Kas ir lielākais MI ieviešanas risks?', 6, 'Regulējums'),
    ('Kas notiks ar uzņēmumiem, kuri tuvāko divu gadu laikā MI neieviesīs?', 1, 'Būtiski zaudēs konkurētspēju'),
    ('Kas notiks ar uzņēmumiem, kuri tuvāko divu gadu laikā MI neieviesīs?', 2, 'Atpaliks tikai atsevišķos procesos'),
    ('Kas notiks ar uzņēmumiem, kuri tuvāko divu gadu laikā MI neieviesīs?', 3, 'Nekas būtisks nemainīsies'),
    ('Kas notiks ar uzņēmumiem, kuri tuvāko divu gadu laikā MI neieviesīs?', 4, 'Tas ir atkarīgs no nozares'),
    ('Vai pēc šīs konferences plānojat aktīvāk ieviest MI savā uzņēmumā?', 1, 'Jā, tuvāko trīs mēnešu laikā'),
    ('Vai pēc šīs konferences plānojat aktīvāk ieviest MI savā uzņēmumā?', 2, 'Jā, bet vispirms jāizvērtē iespējas'),
    ('Vai pēc šīs konferences plānojat aktīvāk ieviest MI savā uzņēmumā?', 3, 'Vēl neesmu pārliecināts'),
    ('Vai pēc šīs konferences plānojat aktīvāk ieviest MI savā uzņēmumā?', 4, 'Nē')
)
insert into poll_options (poll_id, label, display_order)
select polls.id, option_seed.label, option_seed.display_order
from polls
join events on events.id = polls.event_id
join option_seed on option_seed.title = polls.title
where events.slug = 'ai-reality-check-2026'
  and not exists (
    select 1
    from poll_options existing
    where existing.poll_id = polls.id
      and existing.label = option_seed.label
  );
