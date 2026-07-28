# Pilnas funkcionalitātes ieviešanas plāns

## 1. Backend, datubāze, secrets

Rezultāts:
- Supabase/Postgres shēma.
- `.env.example`.
- server-side pieeja Company360, e-pastiem un tokeniem.

Done:
- migrācija iziet bez kļūdām;
- sensitīvās atslēgas nav frontend kodā;
- RLS ieslēgts visām datu tabulām.

## 2. Reģistrācija

Rezultāts:
- `POST /api/registrations`;
- frontend forma sūta reālus datus;
- statuss sākas ar `application_received`.

Done:
- amats nav obligāts;
- obligātie lauki tiek validēti serverī;
- dalībnieks pēc reģistrācijas redz apstiprinājumu.

## 3. Company360 proxy

Rezultāts:
- `GET /api/companies/search?q=`;
- backend sauc Company360 `/v1/search`;
- izvēlētais uzņēmums tiek saglabāts `companies`.

Done:
- API key ir tikai serverī;
- meklēšana strādā pēc nosaukuma un reģ. nr.;
- saglabājas juridiskais nosaukums, reģ. nr., nozare, lielums un reģions.

## 4. E-pasti un magic link

Rezultāts:
- pieteikums saņemts;
- dalība apstiprināta;
- gaidīšanas saraksts;
- atkārtota ierašanās apstiprināšana;
- atgādinājums pirms pasākuma.

Done:
- katrs e-pasts tiek logots `email_deliveries`;
- magic link tokeni glabājas hash veidā;
- links atver dalībnieka AI Pass bez paroles.

## 5. AI Pass un QR

Rezultāts:
- `GET /api/pass/:token`;
- QR kods ar unikālu tokenu;
- dalībnieka statuss, programma un izvēles.

Done:
- QR nesatur vārdu, e-pastu vai uzņēmumu;
- tokenu var atsaukt;
- AI Pass strādā mobilajā skatā.

## 6. Admin apstiprināšana

Rezultāts:
- reģistrāciju saraksts;
- apstiprināt, atteikt, gaidīšanas saraksts;
- 100 vietu kontrole.

Done:
- nevar pārsniegt kapacitāti bez apzinātas admin darbības;
- apstiprinājums nosūta e-pastu;
- statusa maiņas ir auditējamas.

## 7. Check-in

Rezultāts:
- QR skeneris telefonam/planšetei;
- `POST /api/checkin/scan`;
- duplicate scan brīdinājums.

Done:
- pirmais skens atzīmē `arrived`;
- atkārtots skens rāda brīdinājumu;
- admin redz ieradušos skaitu reāllaikā.

## 8. Live programma

Rezultāts:
- pilna programma;
- aktuālais punkts;
- admin manuāla pārslēgšana;
- realtime update dalībniekiem.

Done:
- pauze netiek attēlota kā aktīva prezentācija;
- “Šobrīd” mainās bez lapas pārlādes;
- mobilā navigācija paliek ātra un vienkārša.

## 9. Jautājumi un moderācija

Rezultāts:
- jautājumi piesaistīti programmas punktiem;
- anonīmi vai ar vārdu;
- balsošana par jautājumiem;
- moderatora skats.

Done:
- 280 rakstzīmju limits;
- viens balsojums par jautājumu no vienas sesijas/dalībnieka;
- moderators var apstiprināt, paslēpt, pārcelt un atzīmēt kā atbildētu.

## 10. Balsojumi un rezultāti

Rezultāts:
- admin veido un aktivizē balsojumus;
- dalībnieki balso telefonā;
- rezultāti publicējami uzreiz vai pēc slēgšanas.

Done:
- viena balss vienā balsojumā;
- anonīms režīms strādā bez profila;
- rezultāti tiek rādīti kopā un agregētos Company360 griezumos.

## 11. Apple Wallet / Google Wallet

Rezultāts:
- Apple `.pkpass`;
- Google Wallet Event Ticket;
- pogas e-pastos un AI Pass.

Done:
- Wallet biļetē ir QR, datums, vieta un statuss;
- statuss atjaunojas pēc apstiprinājuma vai atteikuma;
- sertifikāti un service account faili nav repo.

## 12. Arhīvs un rezultātu lapa

Rezultāts:
- `/rezultati`;
- pēc konferences programma, jautājumi, materiāli, video un kopējais AI Reality Check.

Done:
- publiski redzami tikai apkopoti dati;
- programmas punkts kļūst par atsevišķu satura vienību;
- materiālus var pievienot admin panelī.
