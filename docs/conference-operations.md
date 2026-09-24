# Konferences operēšanas instrukcija

Šī instrukcija paredzēta AI Reality Check 2026 produkcijas pasākumam. Pirms konferences visu secību izspēlēt mēģinājuma pasākumā ar `?event=rehearsal-...`; mēģinājuma saites neizmantot konferences dienā.

## Galvenais princips

Vienai darbībai ir viens īpašnieks:

- **pasākuma administrators** vada programmas laiku un pieņem lēmumus par novirzēm no grafika;
- **moderators** atlasa jautājumus un vada balsojumu saturu;
- **tehniskais operators** atbild par to, ko konkrētajā brīdī redz lielais ekrāns, un par PowerPoint;
- **check-in operators** strādā tikai ar ieejas skeneri.

Programmas punkta maiņa pati nepārslēdz prezentācijas skatu vai jautājumus. Balsojums ir izņēmums: aktivizējot balsojumu, tas automātiski kļūst par vienīgo aktīvo balsojumu un prezentācijas skatā uzreiz parādās tā jautājums.

## Ieteicamais tehniskais komplekts

### Drošākais variants

Izmantot trīs neatkarīgas ierīces:

1. **Administratora/moderatora dators** — `https://konference.animas.lv/admin/`.
2. **PowerPoint dators** — visas runātāju prezentācijas lokāli, savienots ar video pārslēdzēju.
3. **Portāla prezentācijas dators** — `https://konference.animas.lv/present/` pilnekrānā, savienots ar otru video pārslēdzēja ieeju.

Projektors vai LED ekrāns saņem video no HDMI pārslēdzēja vai video miksera. Tehniskais operators pārslēdz:

- **PPT** — runātāja slaidi;
- **PORTĀLS** — gaidīšanas ekrāns, programma, balsojumi, jautājumi un paziņojumi.

Šis variants neparāda auditorijai Windows darbvirsmu, paziņojumus vai operatora darbības un ļauj saglabāt PowerPoint atvērtu, kamēr redzams portāls.

### Ja nav video pārslēdzēja

Var izmantot vienu prezentāciju datoru ar Windows paplašināto ekrānu:

1. Windows displeja režīms: **Extend**, nevis Duplicate.
2. Projektors ir `Monitor 2`.
3. Pārlūka logu ar `/present/` novieto uz `Monitor 2` un nospiež `F`, lai ieslēgtu portāla pilnekrānu.
4. PowerPoint iestata **Slide Show → Monitor 2** un ieslēdz Presenter View.
5. Portāls visu laiku paliek pilnekrānā zem PowerPoint slaidrādes.
6. Sākot runātāju, palaiž PowerPoint slaidrādi — tā pārklāj portālu.
7. Beidzot runātāju, nospiež `Esc` — zem slaidrādes uzreiz atkal redzams portāls.

Admin paneli šajā variantā vada no citas ierīces. Neizmanto `Alt+Tab` uz auditorijai redzamā ekrāna, ja vien tas nav iepriekš pilnībā izmēģināts.

## Konti un tiesības

- **Organizer**: programmas labošana, laiku pārbīde, balsojumu izveide un visi tiešraides vadības rīki.
- **Moderator**: jautājumu moderēšana, balsojumu aktivizēšana/aizvēršana, programmas tiešraides vadība un prezentācijas skata vadība.
- **Viewer**: tikai apskate; nav piemērots moderatoram vai tehniskajam operatoram.
- **Superadmin**: lietotāju pārvaldība un pilnas tiesības; ikdienas operēšanai izmantot tikai tad, ja tas tiešām vajadzīgs.

Tehniskajam operatoram vajag `moderator` lomu, ja viņš pats mainīs portāla ekrāna režīmus. Neizmantot vienu kopīgu kontu vairākās lomās; audita žurnālā jābūt redzamam, kurš veica darbību.

Admin sesija pēc aptuveni 30 minūšu neaktivitātes var beigties. Visas ierīces ielogot un pārbaudīt pirms durvju atvēršanas.

## Sagatavošana iepriekšējā dienā

### PowerPoint

- Savākt visas prezentācijas vienā pasākuma datorā un izveidot arī kopiju USB datu nesējā.
- Vienoties par 16:9 formātu un pārbaudīt fontus, video, animācijas un skaņu.
- Failus pārsaukt programmas secībā, piemēram, `01_Atklasana.pptx`, `02_Runatajs.pptx`.
- Atvērt katru failu un iziet cauri vismaz pirmajam, pēdējam un video slaidiem.
- Izslēgt Windows un lietotņu paziņojumus, ekrānsaudzētāju, miega režīmu un automātiskos atjauninājumus.
- Aizvērt e-pastu, čatus un citas programmas, kas var parādīt sensitīvu informāciju.
- Pārbaudīt klikeri no skatuves un sagatavot rezerves baterijas.

### Portāls

- Mēģinājumā pārbaudīt admin, `/present/`, dalībnieka Live un check-in vismaz divās ierīcēs.
- Produkcijas adminā pārbaudīt programmas secību, runātāju vārdus un laikus.
- Visus paredzētos balsojumus sagatavot kā melnrakstus vai plānotus balsojumus; konferences laikā neveidot tos no nulles, ja vien nav ārkārtas vajadzības.
- Pārbaudīt, ka katrs balsojums piesaistīts pareizajam programmas punktam.
- Pārbaudīt anonīmo ieeju no `/pass/`: bez personīgā tokena jābūt iespējai turpināt bez vārda vai ar izvēles vārdu. Reģistrētam dalībniekam jāizmanto apstiprinājuma e-pasta personīgā AI Pass saite.
- Pārbaudīt lielā ekrāna QR kodu ar reālu telefonu.
- Atvērt audita žurnālu un pārliecināties, ka katram operatoram ir savs konts un pareizā loma.

### Sakari un rezerves

- Moderatoram, administratoram un tehniskajam operatoram vienoties par īsām komandām: `PPT gatavs`, `Portāls gatavs`, `Portāls ēterā`, `PPT ēterā`, `Aizvērt balsojumu`.
- Nodrošināt rezerves internetu/hotspot, HDMI adapteri, barošanas blokus, pagarinātāju un rezerves peli.
- Sagatavot vienu neitrālu PowerPoint “pauzes” slaidu gadījumam, ja portāls nav pieejams.

## Konferences dienas pārbaude

Vismaz 60 minūtes pirms sākuma:

1. Ieslēgt tehniku un pārbaudīt projektora izšķirtspēju un malu attiecību.
2. Atvērt produkcijas adminu un pārbaudīt, ka adresē **nav** `event=rehearsal-...`.
3. Atvērt produkcijas `/present/`, ieslēgt pilnekrānu ar `F` un izvēlēties **Gaidīšanas ekrāns**.
4. Pārbaudīt QR kodu ar dalībnieka telefonu.
5. Palaist pirmo PowerPoint un pārbaudīt, ka `Esc` atklāj portālu, nevis darbvirsmu.
6. Pārbaudīt skaņu no PowerPoint video.
7. Ielogot moderatora un check-in ierīces.
8. Atsevišķā mēģinājuma check-in saitē veikt vienu testa skenējumu ar testa biļeti. Pēc tam šo cilni aizvērt un no jauna atvērt produkcijas check-in saiti bez `event=rehearsal-...`; produkcijas dalībniekus tehniskai pārbaudei neskenēt.
9. Pārbaudīt laiku un laika joslu visās operatoru ierīcēs.

## Pasākuma administratora darbs

### Normāla norise

Ja programma iet pēc plāna, atstāt režīmu **Pēc grafika**. Sistēma pēc servera laika pati nosaka aktuālo programmas punktu. Pirms pasākuma sākuma, pēc beigām un tukšos intervālos aktīva punkta nav.

Administrators seko:

- pašreizējam punktam un atlikušajam laikam;
- nākamajam runātājam;
- moderatora un tehniskā operatora gatavībai;
- nepieciešamībai pāriet uz manuālu vadību.

### Ja runātājs sāk agrāk vai programma atpaliek

1. Atvērt **Programma**.
2. Pie vajadzīgā punkta izvēlēties **Sākt šo punktu tagad**.
3. Sistēma pāriet manuālā režīmā un pati vairs nepārslēgs punktu pēc plānotā beigām.
4. Kad punkts beidzas, izmantot **Nākamais punkts**.

Ja pašreizējam runātājam jādod vairāk laika, izvēlēties **Paturēt pašreizējo**. Kad atkal jāseko pulkstenim, izvēlēties **Atgriezties pie grafika**.

### Laiku pārbīde

**Pārbīdīt atlikušos laikus** izmanto tikai pēc pasākuma vadītāja lēmuma. Darbība maina nākamo punktu laikus, bet nemaina pašreizējo punktu un sākotnējo plānu.

Pirms apstiprināšanas skaļi saskaņot:

- par cik minūtēm pārbīdīt;
- vai pašreizējais punkts paliek nemainīts;
- vai moderators un tehniskais operators sapratuši jauno plānu.

Programmas secību, runātāju datus un balsojumu saturu konferences laikā rediģēt tikai tad, ja kļūda tiešām ietekmē norisi.

## Moderatora darbs

### Jautājumu moderēšana runātāja laikā

1. Atvērt **Moderācija → Gaida**.
2. Filtrēt pēc pašreizējā programmas punkta.
3. **Apstiprināt** saprotamus, atbilstošus jautājumus.
4. Dublikātus, aizskarošu saturu un neatbilstošus jautājumus izvēlēties **Paslēpt**.
5. Jautājumu drīkst rediģēt tikai valodas vai salasāmības dēļ, nemainot autora domu. Oriģināls paliek audita žurnālā.
6. Sarunā ar skatuves moderatoru noteikt jautājumu secību.

Apstiprināšana padara jautājumu pieejamu publiskajā jautājumu plūsmā. **Rādīt uz ekrāna** jāspiež tikai pēc tehniskā operatora signāla, ka portāla avotu drīkst rādīt auditorijai.

### Q&A secība

1. Kamēr vēl redzams PowerPoint, moderators atlasa nākamo jautājumu.
2. Moderators saka `Portāls gatavs`.
3. Tehniskais operators beidz slaidrādi ar `Esc` vai pārslēdz avotu uz PORTĀLS.
4. Kad saņemts signāls `Portāls ēterā`, moderators spiež **Rādīt uz ekrāna**.
5. Pēc atbildes moderators izvēlas **Atzīmēt kā atbildētu**.
6. Nākamajam jautājumam atkārto 4.–5. soli.
7. Q&A beigās tehniskais operators pārslēdzas uz nākamā runātāja PowerPoint vai moderators izvēlas **Programmas punkts/Gaidīšanas ekrāns**.

Jautājumus konferences laikā labāk paslēpt vai arhivēt, nevis dzēst. Dzēšana ir neatgriezeniska.

### Balsojuma secība

1. Atvērt **Balsojumi** un atrast iepriekš sagatavoto balsojumu.
2. Pārbaudīt pie balsojuma norādīto programmas punktu.
3. Pēc skatuves moderatora signāla izvēlēties **Aktivizēt**. Iepriekšējais aktīvais balsojums automātiski tiek aizvērts, bet jaunā balsojuma jautājums uzreiz tiek sagatavots prezentācijas skatā.
4. Tehniskais operators pārslēdz lielo ekrānu uz PORTĀLS.
5. Skatuves moderators dod auditorijai laiku balsot un nosauc atskaiti, piemēram, “vēl 5 sekundes”.
6. Lai jebkurā brīdī parādītu līdzšinējās atbildes, nospiest **Atbildes**. Balsojums paliek atvērts, un rezultāti prezentācijā turpina atjaunoties.
7. Kad atbildes vairs nepieņem, izvēlēties **Noslēgt**. Ja rezultāti jau ir ekrānā, tie paliek redzami.
8. Pēc rezultātu apspriešanas izvēlēties **Programmas punkts**, **Auditorijas jautājumi** vai **Gaidīšanas ekrāns**.

Vienlaikus drīkst būt tikai viens aktīvs balsojums. Nav atsevišķi jāspiež **Prezentēt**, nav jāaizver balsojums pirms rezultātu rādīšanas un nav jāizmanto bulttaustiņš, lai atrastu pareizo rezultātu skatu.

## Tehniskā operatora darbs

Tehniskais operators ir vienīgais, kurš pārslēdz auditorijai redzamo video avotu.

### Pirms katra runātāja

1. Atvērt pareizo PowerPoint failu un pārbaudīt pirmo slaidu.
2. Pārliecināties, ka portāls zem tā ir drošā režīmā: **Programmas punkts** vai **Gaidīšanas ekrāns**.
3. Saņemt apstiprinājumu no administratora, ka sākas pareizais programmas punkts.
4. Palaist slaidrādi uz projektora un tikai tad dot klikeri runātājam.

### Pāreja no PowerPoint uz portālu

1. Moderators sagatavo balsojumu vai jautājumu un saka `Portāls gatavs`.
2. Ja ir video pārslēdzējs, pārslēgt uz PORTĀLS.
3. Ja ir viens dators, nospiest `Esc`; portālam jau jābūt pilnekrānā zem PowerPoint.
4. Apskatīt lielā ekrāna priekšskatījumu un pateikt `Portāls ēterā`.
5. Tikai tad moderators maina vai prezentē nākamo jautājumu, ja tas vēl nav izdarīts.

### Pāreja no portāla uz PowerPoint

1. Atvērt pareizo prezentāciju un sagatavot pirmo vajadzīgo slaidu.
2. Pārslēdzēja variantā palaist slaidrādi pirms avota pārslēgšanas.
3. Viena datora variantā palaist PowerPoint slaidrādi uz `Monitor 2`; tā pārklās portālu.
4. Pārbaudīt, ka auditorija redz tikai slaidu, un pateikt `PPT ēterā`.

Portāla `/present/` lapā `F` ieslēdz/izslēdz pilnekrānu. `Escape` iziet no pārlūka pilnekrāna, tādēļ šo taustiņu lietot PowerPoint logā, nevis fokusētā portāla logā.

## Prezentācijas tālvadības īsceļi

Īsceļi darbojas admina **Vadības pultī**, ja kursors neatrodas teksta laukā:

- `→` — nākamais portāla ekrāna režīms;
- `←` — iepriekšējais portāla ekrāna režīms;
- `Q` — auditorijas jautājumi;
- `W` — gaidīšanas ekrāns;
- `R` — pārslēdz rezultātu redzamības iestatījumu.

Drošāk ir izmantot nosauktās režīmu pogas. Balsojuma rezultātiem izmanto tiešo pogu **Atbildes**; bulttaustiņus atstāj tikai apzinātai citu ekrāna režīmu pārslēgšanai.

## Check-in operatora darbs

1. Telefonā atvērt **Check-in skeneris** un ielogoties ar savu kontu.
2. Atļaut pārlūkam pieeju aizmugurējai kamerai.
3. Pavērst kameru pret dalībnieka Pass QR kodu.
4. Zaļš rezultāts nozīmē, ka ierašanās reģistrēta.
5. Atkārtots skenējums tiek parādīts atsevišķi un saglabāts žurnālā; dalībnieku nevajag reģistrēt vēlreiz manuāli.
6. Pēc katra rezultāta izvēlēties nākamo skenējumu.

Ja kamera nedarbojas, pārbaudīt pārlūka kameras atļauju. Ja internets nav pieejams, pierakstīt dalībnieka vārdu lokālā sarakstā un ievadīt/skenēt pēc savienojuma atjaunošanas.

## Ārkārtas scenāriji

### Portāls vai internets nav pieejams

- Nepārtraukt runātāja PowerPoint.
- Jautājumus pieņemt mutiski; balsojumu pārcelt vai veikt ar roku pacelšanu.
- Uz ekrāna izmantot sagatavoto neitrālo PowerPoint pauzes slaidu.
- Administrators pārbauda savienojumu un pārlādē adminu; tehniskais operators nepārslēdz auditoriju uz kļūdas ekrānu.
- `/present/` savienojuma pārtraukumā saglabā pēdējo zināmo skatu, tāpēc tas nav pierādījums, ka vadība joprojām saņem jaunus datus.

### PowerPoint nedarbojas

- Pārslēgt auditoriju uz portāla **Programmas punktu** vai **Gaidīšanas ekrānu**.
- Atvērt lokālo rezerves kopiju vai USB failu.
- Ja prezentāciju nevar atjaunot ātri, runātājs turpina bez slaidiem; neturēt auditorijai redzamu darbvirsmu.

### Nepareizs saturs uz lielā ekrāna

- Tehniskais operators nekavējoties pārslēdz uz drošo PORTĀLS gaidīšanas skatu vai neitrālo PPT slaidu.
- Moderators izlabo portāla režīmu, nevis mēģina labot saturu, kamēr tas ir ēterā.
- Pirms avota atgriešanas tehniskais operators pārbauda priekšskatījumu.

### Programma būtiski kavējas

- Administrators pārslēdz pašreizējo punktu manuāli.
- Pasākuma vadītājs pieņem lēmumu par minūšu pārbīdi.
- Tikai `organizer`/`superadmin` piemēro **Pārbīdīt atlikušos laikus**.
- Moderators un tehniskais operators mutiski apstiprina jauno nākamo punktu.

## Noslēgums

1. Pēc pēdējā satura moderators izvēlas **Noslēguma ekrāns**.
2. Tehniskais operators pārslēdz auditoriju uz PORTĀLS un pārbauda rezultātu QR kodu.
3. Administrators aizver atlikušos aktīvos balsojumus.
4. Eksportē dalībnieku, jautājumu un vajadzīgo balsojumu CSV.
5. Pārbauda audita žurnālu un saglabā incidentu piezīmes.
6. Neizvieto vecākas Edge Functions un neveic rollback konferences laikā, kamēr datubāzē ir nodalīti testa dati.

## Īsā komandu karte pie pults

| Situācija | Administrators | Moderators | Tehniskais operators |
|---|---|---|---|
| Runātājs sāk | Pārbauda/sāk programmas punktu | Uzrauga jautājumus | Rāda PPT |
| Jautājums uz ekrāna | Nemaina grafiku | Atlasa un rāda jautājumu | Rāda PORTĀLU |
| Balsojums | Uzrauga programmas laiku | Aktivizē, pēc vajadzības spiež **Atbildes**, noslēdz | Rāda PORTĀLU |
| Nākamais runātājs | Nākamais punkts vai grafiks | Izvēlas drošu ekrāna režīmu | Sagatavo un rāda nākamo PPT |
| Kavējums | Manuāla vadība/pārbīde | Informē skatuvi | Sagatavo drošu pāreju |
| Tehniska kļūme | Turpina programmas koordinēšanu | Aptur ekrāna satura maiņas | Rāda drošo slaidu/skatu |
