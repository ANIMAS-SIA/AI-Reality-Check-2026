# AI Reality Check 2026 Backend

Šis ir backend ieviešanas pamats pilnai konferences funkcionalitātei. Esošais frontend prototips paliek statisks, bet visi sensitīvie un dinamiskie procesi jāliek servera pusē.

## 1. Datubāze

Sākuma migrācija:

```bash
supabase db push
```

Migrācija atrodas:

```text
supabase/migrations/202607230001_conference_portal_schema.sql
```

Tā izveido tabulas reģistrācijām, dalībniekiem, Company360 datiem, magic link/QR tokeniem, programmai, jautājumiem, balsojumiem, check-in, e-pastiem, Wallet passiem un networking profiliem.

## 2. Secrets

Nokopē `.env.example` uz `.env` lokālai izstrādei. `.env` netiek commitots.

Obligātie sākuma mainīgie:

```text
DATABASE_URL
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
C360_API_KEY
EMAIL_FROM
TOKEN_PEPPER
```

Company360, e-pastu un Wallet atslēgas drīkst izmantot tikai backendā. Tās nedrīkst nonākt publiskajā JavaScript.

## 3. Deploy instrukcija

Kad ir izveidots Supabase projekts, jāizpilda:

```bash
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
supabase secrets set PUBLIC_SITE_URL=https://konference.animas.lv
supabase secrets set C360_API_BASE=https://api.company360.lv
supabase secrets set C360_API_KEY=c360_xxx
supabase secrets set TOKEN_PEPPER=replace_with_long_random_secret
supabase secrets set ADMIN_API_KEY=replace_with_long_random_admin_secret
supabase secrets set MAGIC_LINK_TTL_DAYS=90
supabase secrets set EMAIL_PROVIDER=resend
supabase secrets set EMAIL_FROM="AI Reality Check <konference@animas.lv>"
supabase secrets set RESEND_API_KEY=replace_me
supabase functions deploy companies-search
supabase functions deploy registrations
supabase functions deploy participant-pass
supabase functions deploy admin-registrations
supabase functions deploy checkin-scan
supabase functions deploy live-state
supabase functions deploy admin-live
supabase functions deploy questions
supabase functions deploy admin-questions
supabase functions deploy polls
supabase functions deploy admin-polls
supabase functions deploy results
supabase functions deploy wallet
```

Pēc deploy frontend konfigurācijā jānorāda funkciju bāze:

```js
window.ARC_API_BASE = "https://YOUR_PROJECT_REF.supabase.co/functions/v1";
```

Tas ir publisks URL, ne secrets. To var droši likt `config.js`.

## 4. API endpointi

Ieviešanas secība pēc datubāzes:

```text
GET  /api/companies/search?q=
POST /api/registrations
GET  /api/pass/:token
POST /api/admin/registrations/:id/approve
POST /api/checkin/scan
GET  /api/live/state
POST /api/questions
POST /api/questions/:id/vote
POST /api/polls/:id/vote
GET  /api/polls/:id/results
GET  /api/wallet/apple/:token
GET  /api/wallet/google/:token
```

Supabase Edge Functions versijā sākuma endpointi ir:

```text
GET  {ARC_API_BASE}/companies-search?q=animas
POST {ARC_API_BASE}/registrations
GET  {ARC_API_BASE}/participant-pass?token=
GET  {ARC_API_BASE}/admin-registrations
POST {ARC_API_BASE}/admin-registrations?action=approve&participant_id=
GET  {ARC_API_BASE}/checkin-scan?token=
POST {ARC_API_BASE}/checkin-scan
GET  {ARC_API_BASE}/live-state
POST {ARC_API_BASE}/admin-live?action=set-current&agenda_item_id=
GET  {ARC_API_BASE}/questions
POST {ARC_API_BASE}/questions
POST {ARC_API_BASE}/questions?action=vote
GET  {ARC_API_BASE}/admin-questions
POST {ARC_API_BASE}/admin-questions?question_id=&status=
GET  {ARC_API_BASE}/polls
POST {ARC_API_BASE}/polls
GET  {ARC_API_BASE}/admin-polls
POST {ARC_API_BASE}/admin-polls?action=create
POST {ARC_API_BASE}/admin-polls?action=activate&poll_id=
POST {ARC_API_BASE}/admin-polls?action=close&poll_id=
POST {ARC_API_BASE}/admin-polls?action=publish&poll_id=
GET  {ARC_API_BASE}/results
GET  {ARC_API_BASE}/wallet?provider=apple&token=
GET  {ARC_API_BASE}/wallet?provider=google&token=
```

Admin endpointiem (`admin-*`, `presentation` POST, `presentation-links`) tagad jāpadod Supabase Auth sesijas token, nevis `x-admin-key`:

```text
Authorization: Bearer <supabase-auth-access-token>
```

Sk. 8. sadaļu.

Realtime Broadcast kanāls:

```text
live:ai-reality-check-2026
```

Frontend push notikumiem `config.js` jānorāda publiskais Supabase anon/publishable key:

```js
window.SUPABASE_URL = "https://zoxeflvpiierezdzxwdq.supabase.co";
window.SUPABASE_ANON_KEY = "ieliec_public_anon_vai_publishable_key";
```

Ja `SUPABASE_ANON_KEY` nav norādīts, Live lapa turpina strādāt ar 10 sekunžu polling.

## 5. Wallet production dati

Wallet endpointi tagad pieslēdz pogas e-pastos un AI Pass skatā, kā arī reģistrē pass statusu datubāzē. Apple Wallet pass tiek ģenerēts caur PerkPass (https://perkpass.co.uk), nevis ar pašu parakstītu sertifikātu. Pilnai production palaišanai vajadzīgi vēl šie secrets:

```text
PERKPASS_API_KEY
GOOGLE_WALLET_ISSUER_ID
GOOGLE_WALLET_CLASS_ID
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64
```

`wallet?provider=apple&token=...` pirmajā izsaukumā izveido PerkPass pass un saglabā `serial_number`/`share_url` tabulā `wallet_passes` (`provider = 'apple'`); nākamie izsaukumi atgriež jau saglabāto `share_url`, neveidojot jaunu pass. Ja `PERKPASS_API_KEY` trūkst vai PerkPass atgriež kļūdu, endpoints atgriež 502 (429 rate-limit gadījumā) ar vispārīgu ziņojumu, bet pilnu PerkPass atbildi un statusu ieraksta funkcijas logā.

Google endpointis ģenerē parakstītu Save JWT, ja ir iestatīts `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` vai `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`.

## 6. Realtime kanāli

Ieteiktie kanāli:

```text
event:{event_id}:agenda
event:{event_id}:questions
event:{event_id}:polls
event:{event_id}:results
event:{event_id}:checkins
```

Admin panelis maina programmas statusu, jautājumu moderāciju un balsojumu statusus. Dalībnieku `/live` lapa klausās tikai publicējamos notikumus.

## 7. Drošības principi

- QR kodā ir tikai tokenizēts identifikators, nevis personas dati.
- Magic link tokeni datubāzē glabājas tikai hash veidā.
- Reģistrāciju, e-pastu un Wallet darbībām jāizmanto servera service role.
- Publiskajiem rezultātiem jāizmanto agregācija un minimālais grupas slieksnis.
- Anonīmi iesniegtās atbildes pēc pilnās pieejas aktivizēšanas netiek piesaistītas profilam.

## 8. Admin panelis un prezentācijas skats

`/admin` (vadības panelis) un `/present` (pilnekrāna prezentācijas skats) aizstāj veco vienkāršo `admin/index.html` formu ar kopīgu `x-admin-key`. Autorizācija tagad ir Supabase Auth (e-pasts + parole), lomas glabājas `admin_profiles` tabulā.

**Palaišanas secība production vidē:**

1. **Ieslēdz Email auth provideri** Supabase Studio → Authentication → Providers → Email (ja vēl nav ieslēgts). Iestati arī "Site URL" un redirect URL uz `https://<tava-domēna>/admin/`, lai "Aizmirsu paroli" saite strādātu.
2. **Palaiž migrāciju**:
   ```bash
   supabase db push
   ```
   Migrācija `supabase/migrations/202607240001_admin_platform_and_presentation.sql` pievieno: `admin_profiles`, `presentation_state`, `presentation_links`, `poll_text_responses` tabulas; paplašina `agenda_items`/`questions`/`polls` statusus un laukus; maina `poll_votes` unikālos ierobežojumus (lai atbalstītu vairāku atbilžu balsojumus).
3. **Izveido pirmo superadmin lietotāju** (jaunam admin_users invite endpointam jau ir nepieciešams esošs superadmin, tāpēc pirmais jāpievieno manuāli):
   - Supabase Studio → Authentication → Users → "Add user" (vai "Invite") ar organizatora e-pastu.
   - Nokopē jaunā lietotāja `User UID`.
   - SQL Editorā:
     ```sql
     insert into admin_profiles (user_id, role, display_name, status)
     values ('<user-uid>', 'superadmin', 'Vārds Uzvārds', 'active');
     ```
   - Tālāk pārējos lietotājus (organizators/moderators/utt.) var uzaicināt tieši no admin paneļa (profila izvēlne → Lietotāji), jo tas izmanto `admin-users?action=invite`.
4. **Deployo jaunās/mainītās edge funkcijas**:
   ```bash
   supabase functions deploy admin-registrations admin-live admin-polls admin-questions admin-users presentation presentation-links polls wallet
   ```
   Jauns koplietots modulis: `supabase/functions/_shared/auth.ts` (`authenticateAdmin`/`logAudit`) — to izmanto visas `admin-*` un `presentation*` funkcijas, tāpēc jādeployo kopā ar tām.
5. **Nav jaunu secrets** — autorizācija iet caur jau esošo `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, admin lietotāju pārvaldībai izmanto GoTrue Admin API ar to pašu service role atslēgu.

**Lomas** (`admin_profiles.role`): `superadmin` (viss, ieskaitot lietotāju pārvaldību), `organizer` (programma, balsojumi, jautājumi, dalībnieki, prezentācija), `moderator` (jautājumu moderācija, balsojumu vadība, prezentācijas tālvadība), `viewer` (tikai lasīšana), `screen` (rezervēta loma turpmākai lietošanai — prezentācijas GET jau tāpat ir publisks, jo nesatur personas datus).

**Prezentācijas ierobežota termiņa saite** (§3.1 alternatīva pilnai autorizācijai): `presentation-links` funkcija ļauj superadminam ģenerēt/atcelt tokenus (`POST ?action=create`), un `GET ?action=verify&token=` publiski pārbauda derīgumu. Šai iespējai vēl nav pievienota poga admin panelī — endpointi ir gatavi, UI jāpievieno nākamajā solī, ja tas tiek izmantots.

**Zināmie ierobežojumi šajā versijā:**
- PDF eksports ir printējama HTML lapa (`window.print()`), nevis servera ģenerēts PDF — Deno edge vidē nav uzticamas PDF bibliotēkas bez papildu atkarībām.
- Divu dimensiju matrica, viktorīna, prioritāšu sarindošana un variantu salīdzināšana (uzdevuma "nākamais attīstības posms") nav ieviestas.
- Microsoft 365 SSO nav ieviests — izvēlēts e-pasts/parole variants.
