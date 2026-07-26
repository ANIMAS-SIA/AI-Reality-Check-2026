// Single source of truth for the AI maturity scale (1-10), shared by the
// registration slider, the admin panel and the results page.
window.MATURITY_LEVELS = [
  {
    level: 1,
    phase: "Izpēte",
    title: "Akmens laikmets",
    description: "MI rīki uzņēmumā vēl netiek izmantoti. Darbs notiek ierastajā veidā — reizēm pat ļoti ierastajā.",
    imageUrl: "/maturity/level-01-caveman.webp",
  },
  {
    level: 2,
    phase: "Izpēte",
    title: "Pirmie mēģinājumi",
    description: "Daži darbinieki individuāli izmanto MI rīkus, bet uzņēmuma procesi vēl nav mainīti.",
    imageUrl: "/maturity/level-02-first-tests.webp",
  },
  {
    level: 3,
    phase: "Eksperimenti",
    title: "Rīku kolekcionāri",
    description: "Komanda izmēģina vairākus MI rīkus, taču vēl meklē, kuri no tiem patiešām dod rezultātu.",
    imageUrl: "/maturity/level-03-tool-chaos.webp",
  },
  {
    level: 4,
    phase: "Eksperimenti",
    title: "Pirmais strādājošais process",
    description: "Vismaz vienā procesā MI jau veic konkrētu darbu un regulāri ietaupa komandas laiku.",
    imageUrl: "/maturity/level-04-first-workflow.webp",
  },
  {
    level: 5,
    phase: "Eksperimenti",
    title: "Veidojam sistēmu",
    description: "Vairākas komandas izmanto MI, bet risinājumi vēl nav pilnībā savienoti un pārvaldīti vienoti.",
    imageUrl: "/maturity/level-05-connected-teams.webp",
  },
  {
    level: 6,
    phase: "Ieviešana",
    title: "Procesi sāk sarunāties",
    description: "MI risinājumi ir savienoti ar uzņēmuma datiem un sistēmām, automatizējot vairākus darba posmus.",
    imageUrl: "/maturity/level-06-integrated-processes.webp",
  },
  {
    level: 7,
    phase: "Ieviešana",
    title: "Sistēmiski ieviešam",
    description: "MI tiek izmantots vairākos procesos, ir noteikti atbildīgie un tiek mērīti rezultāti.",
    imageUrl: "/maturity/level-07-systematic.webp",
  },
  {
    level: 8,
    phase: "Ieviešana",
    title: "Pārvaldām un mēram",
    description: "MI izmantošana tiek pārvaldīta uzņēmuma līmenī, risinājumiem ir KPI, drošības un kvalitātes kontrole.",
    imageUrl: "/maturity/level-08-governed.webp",
  },
  {
    level: 9,
    phase: "Līderis",
    title: "Prognozējam un optimizējam",
    description: "MI palīdz prognozēt notikumus, pieņemt lēmumus un nepārtraukti uzlabot uzņēmuma darbību.",
    imageUrl: "/maturity/level-09-predictive.webp",
  },
  {
    level: 10,
    phase: "Līderis",
    title: "MI ir biznesa kodolā",
    description: "Uzņēmuma produkti, procesi un lēmumi ir veidoti ap MI iespējām, saglabājot cilvēku atbildību.",
    imageUrl: "/maturity/level-10-ai-native.webp",
  },
];

window.maturityLevelByNumber = function maturityLevelByNumber(level) {
  return window.MATURITY_LEVELS.find((item) => item.level === Number(level)) || null;
};
