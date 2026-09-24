# Programmas vadība un mēģinājums

## Darbība

- Dalībnieka pieeja nav piesaistīta pasākuma sākuma laikam.
- **Pēc grafika:** servera pulkstenis izvēlas punktu intervālā `[starts_at, ends_at)`. Pauzes ir pilnvērtīgi punkti; atceltus punktus ignorē. Pirms sākuma, pēc beigām un tukšos intervālos aktīva punkta nav.
- **Manuāla vadība:** “Sākt šo punktu tagad”, “Paturēt pašreizējo” un “Nākamais punkts” saglabā izvēli. Tā pati nepārslēdzas, arī pēc plānotajām beigām. “Atgriezties pie grafika” atkal izmanto laiku.
- **Pārbīdīt atlikušos laikus:** atsevišķa, apstiprināma darbība. Pārbīda sākumu un beigas punktiem pēc pašreizējā; ja tā nav — punktiem, kas vēl nav sākušies. Pašreizējā punkta laiki un sākotnējais plāns nemainās. Atļautas arī negatīvas minūtes.
- `planned_starts_at` / `planned_ends_at` ir sākotnējais plāns, `starts_at` / `ends_at` — pašreizējais grafiks. `actual_started_at` reģistrē pirmo organizatora manuālo sākšanu. Automātiska izvēle nav pierādījums faktiskai uzstāšanās sākšanai, tādēļ šo lauku automātiski neaizpilda.
- Programmas pārslēgšana balsojumus nemaina. Aktivizējot balsojumu, iepriekšējais aktīvais balsojums tiek aizvērts un prezentācijā automātiski parādās jaunā balsojuma jautājums; moderators var uzreiz pārslēgt uz dzīvajām atbildēm, balsojumu neaizverot.
- Live atjauno datus aptuveni ik pēc 10 sekundēm, administrācija — 15 sekundēm; manuālās izmaiņas papildus paziņo attiecīgā pasākuma Realtime kanālā.

## Mēģinājuma izveide

Administrācijas vadības pults → **Laiku pārbīde un mēģinājums** → norādīt sākuma datumu/laiku → **Izveidot atsevišķu mēģinājumu**. Datuma ievade izmanto organizatora ierīces laika joslu; programma attēlo Rīgas laiku.

Atvērt izveidoto administrācijas saiti. Tās `?event=rehearsal-…` ir pasākuma identifikators. Saite ir atkārtoti izmantojama un kopīgojama ar pārējiem organizatoriem. Mēģinājums nokopē aktuālo programmu (ieskaitot pauzes un ilgumus), materiālu saites un balsojumu jautājumus/opcijas. Balsojumi sākas melnrakstā. Īstos dalībniekus, balsis, jautājumus, tokenus un check-in nekopē.

**Izveidot testa dalībnieku** dod atsevišķu Pass saiti un QR. Atverot Pass, dalībnieks tāpat kā produkcijā var pāriet uz Live. Citai ierīcei nokopē Pass saiti. Katram testētājam izveido savu testa dalībnieku. Tokeni derīgi 7 dienas. No testa administrācijas atver prezentācijas un skenera saites — pasākuma parametrs saglabājas arī navigācijā un QR.

Laiks netiek apturēts vai paātrināts: tiek pārbīdīta programmas kopija un tālāk darbojas īsts laiks. Citam sākuma datumam vai tīram atkārtojumam izveido jaunu mēģinājumu.

### Drošības robežas

- Viens Supabase projekts, atsevišķi pasākuma dati. Serveris piemēro pasākuma filtru arī administrācijas sarakstiem, eksportiem, tokeniem un atbildēm; pārbauda rakstāmo ierakstu saites.
- Testa vidē nav reālu e-pastu, Microsoft Calendar vai Wallet darbību. Reģistrācijas/atcelšanas/apstiprināšanas darbības, kas tos izraisa, ir bloķētas. Dalībnieku rediģēšana, check-in un skatuves darbības ir pieejamas. **Šis nav e-pasta vai kalendāra integrāciju tests.** Kopīgo administratoru kontus testā nemaina.
- Dalībnieku pārlūka krātuve un Realtime kanāli ir nodalīti pēc pasākuma.
- Priekšskatījuma adresē bez testa parametra pieejama avota lasīšana un mēģinājuma izveide, bet ne īstā pasākuma rakstīšana. Produkcijas rakstīšanai priekšgals atļauj tikai `konference.animas.lv`; tas ir papildu aizsargs pret kļūdu, nevis servera autorizācijas aizstājējs.

## Izvietošanas secība

Lokālās izmaiņas atrodas zarā `feature/event-rehearsal`. Pirms izvietošanas pārskatīt diff un saglabāt arī iepriekšējās necommitotās portāla izmaiņas.

1. Pārbaudīt piesaistīto Supabase projektu un nodrošināt datubāzes rezerves kopiju.
2. Piemērot neizpildītās migrācijas, tostarp `202609220001_event_rehearsal.sql` un `202609240001_guest_access_single_active_poll.sql`. Tās ir papildinošas. Ja vecajos datos vienam pasākumam ir vairāki aktīvi balsojumi, jaunāk aktivizētais paliek aktīvs, bet pārējie tiek korekti aizvērti; jautājumi un atbildes netiek dzēsti.
3. Izvietot **visas** šā zara Supabase funkcijas (ne tikai `admin-live`): kopīgais REST slānis un pasākuma konteksts mainīti visām. Arī jauno `admin-rehearsal`; konfigurācijā JWT pārbaudi veic pati funkcija ar administratora autentifikāciju.
4. Izvietot zara Vercel Preview, neatstājot to par Production un nemainot domēna piesaisti. GitHub Pages veiksmīgs build nav Vercel izvietojuma apstiprinājums.
5. Tikai pēc visu funkciju izvietošanas izveidot pirmo mēģinājumu. Daļēji atjaunināts backend nav drošs mēģinājuma darbībai.
6. Pārbaudīt divās ierīcēs: anonīmo ieeju bez tokena, izvēles vārdu, automātisku pāreju uz pauzi/runātāju, agrāku manuālu sākumu, pārsniegtu laiku, atgriešanos grafikā, laiku pārbīdi, viena aktīva balsojuma principu, dzīvo atbilžu rādīšanu prezentācijā, jautājumu moderēšanu un atkārtotu check-in. Produkcijas atskaitēs testa ieraksti nedrīkst parādīties.

Rollback: kamēr tajā pašā Supabase ir testa dati, **neatgriezt vecās nenodalītās Edge Functions** — tās varētu iekļaut testa ierakstus kopīgajos sarakstos. Frontendu var atgriezt uz iepriekšējo deployment, saglabājot jauno, nodalīto backend. Migrācijas kolonnas un oriģinālos datus nedzēst.

## Lokālā pārbaude

`node --test tests/event-control.test.mjs` pārbauda laika režīmus, REST nodalīšanu un priekšskatījuma aizsardzību. `deno check supabase/functions/*/index.ts` pārbauda funkciju tipus (PowerShell jāizvērš failu saraksts).

`tests/rehearsal.sql` palaist tikai izolētā lokālā PostgreSQL pēc visām migrācijām. Tas pārbauda kopēšanu, ilgumus, manuālo vadību, pārbīdi, SQL tiesības un avota datu nemainību; visas testa darbības atceļ ar `ROLLBACK`.
