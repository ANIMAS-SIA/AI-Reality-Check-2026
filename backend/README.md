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

Admin endpointiem jāpadod header:

```text
x-admin-key: ADMIN_API_KEY vērtība
```

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

Wallet endpointi tagad pieslēdz pogas e-pastos un AI Pass skatā, kā arī reģistrē pass statusu datubāzē. Pilnai production palaišanai vajadzīgi vēl šie secrets:

```text
APPLE_PASS_TYPE_ID
APPLE_TEAM_ID
APPLE_PASS_CERT_P12_BASE64
APPLE_PASS_CERT_PASSWORD
GOOGLE_WALLET_ISSUER_ID
GOOGLE_WALLET_CLASS_ID
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64
```

Kamēr Apple sertifikāti nav pieslēgti, Apple endpointis atgriež pass payload pārbaudei, bet ne parakstītu `.pkpass`. Google endpointis ģenerē parakstītu Save JWT, ja ir iestatīts `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` vai `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64`.

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
