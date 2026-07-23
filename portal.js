const STORE_KEY = "aiRealityParticipant";

const companies = [
  { name: "SIA ANIMAS", reg: "40203377881", sector: "Tehnologijas", size: "Mazs uzņēmums", region: "Rīga", type: "Privātais sektors" },
  { name: "VAS Ceļu satiksmes drošības direkcija", reg: "40003345734", sector: "Transports", size: "Liels uzņēmums", region: "Latvija", type: "Publiskais sektors" },
  { name: "SIA Omniva", reg: "40103527192", sector: "Loģistika", size: "Vidējs uzņēmums", region: "Rīga", type: "Privātais sektors" },
  { name: "SIA Estimo", reg: "40203456781", sector: "Finanšu tehnoloģijas", size: "Mazs uzņēmums", region: "Rīga", type: "Privātais sektors" }
];

const API_BASE = (window.ARC_API_BASE || "").replace(/\/$/, "");
const REALTIME_TOPIC = "live:ai-reality-check-2026";

const defaultParticipant = {
  firstName: "Betija",
  lastName: "Muižniece",
  email: "betija@animas.lv",
  role: "Dalībniece",
  companyName: "SIA ANIMAS",
  status: "Apstiprināts",
  access: "Pilna pieeja",
  aiStage: "Izmēģinām atsevišķus rīkus",
  passId: "ARC26-0064"
};

function fallbackCompanySearch(q) {
  const needle = q.trim().toLowerCase();
  return companies.filter((company) => company.name.toLowerCase().includes(needle) || company.reg.includes(needle));
}

function normalizeC360Company(item) {
  return {
    name: item.name,
    reg: item.reg || item.registration_number,
    registration_number: item.registration_number || item.reg,
    sector: item.industry || item.nace_text || "",
    size: item.company_size_badge || item.company_size || "",
    region: item.region || "",
    status: item.status || "",
    country: item.country || "LV"
  };
}

async function searchCompanies(q) {
  if (!API_BASE) return fallbackCompanySearch(q);

  try {
    const url = new URL(`${API_BASE}/companies-search`);
    url.searchParams.set("q", q);

    const response = await fetch(url);
    if (!response.ok) throw new Error(`Company search failed: ${response.status}`);
    const data = await response.json();
    const items = data.companies || [];
    return Array.isArray(items) ? items.map(normalizeC360Company) : [];
  } catch (error) {
    console.warn(error);
    return fallbackCompanySearch(q);
  }
}

async function createRegistration(payload) {
  if (!API_BASE) {
    return {
      participant: {
        id: `local-${Date.now()}`,
        status: "application_received",
        access_mode: payload.fullPortal ? "full" : "basic"
      },
      links: {
        pass: "../pass/"
      },
      local: true
    };
  }

  const response = await fetch(`${API_BASE}/registrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Reģistrāciju neizdevās nosūtīt.");
  }
  return data;
}

async function fetchParticipantPass(token) {
  if (!API_BASE || !token) return getParticipant();

  const url = new URL(`${API_BASE}/participant-pass`);
  url.searchParams.set("token", token);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "AI Pass neizdevās ielādēt.");
  return { ...getParticipant(), ...data.participant };
}

function applyWalletLinks(token) {
  const apple = document.getElementById("appleWalletLink");
  const google = document.getElementById("googleWalletLink");
  const qr = document.getElementById("passQrImage");
  if (!API_BASE || !token) {
    apple?.setAttribute("aria-disabled", "true");
    google?.setAttribute("aria-disabled", "true");
    if (qr) qr.removeAttribute("src");
    return;
  }
  if (apple) apple.href = `${API_BASE}/wallet?provider=apple&token=${encodeURIComponent(token)}`;
  if (google) google.href = `${API_BASE}/wallet?provider=google&token=${encodeURIComponent(token)}`;
  if (qr) {
    const checkinUrl = new URL("../checkin/", window.location.href);
    checkinUrl.searchParams.set("token", token);
    qr.src = `https://api.qrserver.com/v1/create-qr-code/?size=512x512&margin=18&data=${encodeURIComponent(checkinUrl.href)}`;
  }
}

function buildEventIcs() {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//AI Reality Check 2026//konference.animas.lv//LV",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    "UID:ai-reality-check-2026@konference.animas.lv",
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").split(".")[0]}Z`,
    "DTSTART:20260930T060000Z",
    "DTEND:20260930T120000Z",
    "SUMMARY:AI Reality Check 2026",
    "LOCATION:Rīgas Motormuzejs\\, Sergeja Eizenšteina iela 8\\, Rīga",
    "DESCRIPTION:Bezmaksas MI konference. Prezentācijas\\, paneļdiskusija\\, networking pusdienas un kafijas pauzes.",
    "URL:https://konference.animas.lv/",
    "END:VEVENT",
    "END:VCALENDAR"
  ];
  return lines.join("\r\n");
}

function initAddToCalendar() {
  const link = document.getElementById("addToCalendarLink");
  if (!link) return;
  const blob = new Blob([buildEventIcs()], { type: "text/calendar;charset=utf-8" });
  link.href = URL.createObjectURL(blob);
}

function initNetworkingPass(token) {
  const networkingPanel = document.getElementById("networkingPanel");
  if (!networkingPanel || !token) return;

  const visible = document.getElementById("networkingVisible");
  const discuss = document.getElementById("networkingDiscuss");
  const looking = document.getElementById("networkingLooking");
  const offer = document.getElementById("networkingOffer");
  const profilesBox = document.getElementById("networkingProfiles");
  const requestsBox = document.getElementById("networkingRequests");

  function renderNetworking(data) {
    if (visible) visible.checked = Boolean(data.profile?.is_visible);
    if (discuss) discuss.value = data.profile?.wants_to_discuss || "";
    if (looking) looking.value = data.profile?.looking_for || "";
    if (offer) offer.value = data.profile?.can_offer || "";
    if (profilesBox) {
      const profiles = data.profiles || [];
      const ownProfile = data.profile ? `
        <article class="card live-networking-own">
          <span class="networking-active">${data.profile.is_visible ? "Tavs profils ir aktīvs" : "Tavs profils pašlaik ir paslēpts"}</span>
          <strong>${data.participant?.name || "Tavs networking profils"}</strong>
          <p class="fine">${[
            data.profile.wants_to_discuss && `Vēlos apspriest: ${data.profile.wants_to_discuss}`,
            data.profile.looking_for && `Meklēju: ${data.profile.looking_for}`,
            data.profile.can_offer && `Varu piedāvāt: ${data.profile.can_offer}`,
          ].filter(Boolean).join(" · ") || "Papildini profilu, lai citi dalībnieki vieglāk atrastu kopīgas tēmas."}</p>
          <a class="btn secondary live-pass-link" href="../pass/">Rediģēt manu profilu</a>
        </article>
      ` : "";
      const otherProfiles = profiles.map((profile) => `
        <article class="card">
          <strong>${profile.name}</strong>
          <p class="fine">${[profile.role, profile.company, profile.email].filter(Boolean).join(" · ")}</p>
          <p class="fine">${profile.wants_to_discuss || profile.looking_for || ""}</p>
          <button class="btn secondary" type="button" data-contact-recipient="${profile.id}">Nosūtīt kontaktpieprasījumu</button>
        </article>
      `).join("");
      const empty = !profiles.length
        ? `<article class="card"><p class="fine">Citu aktīvu networking profilu vēl nav.</p></article>`
        : "";
      profilesBox.innerHTML = `${ownProfile}${otherProfiles}${empty}`;
    }
    if (requestsBox) {
      const requests = data.requests || [];
      requestsBox.innerHTML = requests.length ? requests.map((request) => `
        <article class="card">
          <span class="eyebrow">${request.status}</span>
          <p class="fine">${request.message || "Kontaktpieprasījums"}</p>
          <div class="btn-row">
            <button class="btn secondary" type="button" data-contact-request="${request.id}" data-contact-status="accepted">Apstiprināt</button>
            <button class="btn secondary" type="button" data-contact-request="${request.id}" data-contact-status="declined">Noraidīt</button>
          </div>
        </article>
      `).join("") : "";
    }
  }

  async function reloadNetworking() {
    try {
      const data = await fetchNetworking(token);
      if (data) renderNetworking(data);
    } catch (error) {
      console.warn(error);
    }
  }

  document.getElementById("saveNetworkingProfile")?.addEventListener("click", async () => {
    try {
      await saveNetworking(token, {
        isVisible: Boolean(visible?.checked),
        wantsToDiscuss: discuss?.value || "",
        lookingFor: looking?.value || "",
        canOffer: offer?.value || "",
        acceptsContactRequests: true,
      });
      showToast("Networking profils saglabāts.");
      await reloadNetworking();
    } catch (error) {
      showToast(error.message || "Profilu neizdevās saglabāt.");
    }
  });

  networkingPanel.addEventListener("click", async (event) => {
    const contact = event.target.closest("[data-contact-recipient]");
    const response = event.target.closest("[data-contact-request]");
    try {
      if (contact) {
        await requestNetworkingContact(token, contact.dataset.contactRecipient);
        showToast("Kontaktpieprasījums nosūtīts.");
        await reloadNetworking();
      }
      if (response) {
        await respondNetworkingContact(token, response.dataset.contactRequest, response.dataset.contactStatus);
        showToast("Kontaktpieprasījums atjaunināts.");
        await reloadNetworking();
      }
    } catch (error) {
      showToast(error.message || "Networking darbība neizdevās.");
    }
  });

  reloadNetworking();
}

async function adminRequest(path, options = {}) {
  const adminKey = sessionStorage.getItem("arcAdminKey") || "";
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "x-admin-key": adminKey,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Admin pieprasījums neizdevās.");
  return data;
}

function getAnonSessionId() {
  let id = localStorage.getItem("arcAnonymousSessionId");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `anon-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem("arcAnonymousSessionId", id);
  }
  return id;
}

async function fetchQuestions(agendaItemId) {
  if (!API_BASE) return [];
  const url = new URL(`${API_BASE}/questions`);
  if (agendaItemId) url.searchParams.set("agenda_item_id", agendaItemId);
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Jautājumus neizdevās ielādēt.");
  return data.questions || [];
}

async function submitQuestion(body, agendaItemId, isAnonymous = true) {
  const participantId = getParticipant().participantId || "";
  const response = await fetch(`${API_BASE}/questions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      body,
      agendaItemId,
      isAnonymous,
      participantId: isAnonymous ? undefined : participantId,
      anonymousSessionId: getAnonSessionId(),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Jautājumu neizdevās iesniegt.");
  if (data.anonymousSessionId) localStorage.setItem("arcAnonymousSessionId", data.anonymousSessionId);
  return data;
}

async function voteQuestion(questionId) {
  const response = await fetch(`${API_BASE}/questions?action=vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      questionId,
      anonymousSessionId: getAnonSessionId(),
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Balsojumu neizdevās iesniegt.");
  if (data.anonymousSessionId) localStorage.setItem("arcAnonymousSessionId", data.anonymousSessionId);
  return data;
}

async function fetchPollState() {
  if (!API_BASE) return { active: null, results: [] };
  const response = await fetch(`${API_BASE}/polls`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Balsojumus neizdevās ielādēt.");
  return data;
}

async function fetchResults() {
  if (!API_BASE) return null;
  const response = await fetch(`${API_BASE}/results`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Rezultātus neizdevās ielādēt.");
  return data;
}

async function fetchArchive() {
  if (!API_BASE) return null;
  const response = await fetch(`${API_BASE}/archive`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Arhīvu neizdevās ielādēt.");
  return data;
}

async function fetchNetworking(token) {
  if (!API_BASE || !token) return null;
  const response = await fetch(`${API_BASE}/networking?token=${encodeURIComponent(token)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Networking datus neizdevās ielādēt.");
  return data;
}

async function saveNetworking(token, payload) {
  const response = await fetch(`${API_BASE}/networking?action=profile&token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Profilu neizdevās saglabāt.");
  return data;
}

async function requestNetworkingContact(token, recipientId, message = "") {
  const response = await fetch(`${API_BASE}/networking?action=request&token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipientId, message }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Pieprasījumu neizdevās nosūtīt.");
  return data;
}

async function respondNetworkingContact(token, requestId, status) {
  const response = await fetch(`${API_BASE}/networking?action=respond&token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestId, status }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Pieprasījumu neizdevās atjaunināt.");
  return data;
}

async function submitPollVote(pollId, optionId) {
  const response = await fetch(`${API_BASE}/polls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pollId,
      optionId,
      anonymousSessionId: getAnonSessionId(),
      isAnonymous: true,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Balsojumu neizdevās iesniegt.");
  if (data.anonymousSessionId) localStorage.setItem("arcAnonymousSessionId", data.anonymousSessionId);
  return data;
}

function subscribeLiveRealtime(onMessage) {
  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) return null;
  const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
  const channel = client.channel(REALTIME_TOPIC);
  channel
    .on("broadcast", { event: "state_changed" }, onMessage)
    .on("broadcast", { event: "question_created" }, onMessage)
    .on("broadcast", { event: "question_voted" }, onMessage)
    .on("broadcast", { event: "question_moderated" }, onMessage)
    .on("broadcast", { event: "poll_changed" }, onMessage)
    .on("broadcast", { event: "poll_voted" }, onMessage)
    .subscribe((status, error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") console.warn(status, error);
    });
  return channel;
}

function getParticipant() {
  try {
    return { ...defaultParticipant, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
  } catch {
    return defaultParticipant;
  }
}

function saveParticipant(data) {
  localStorage.setItem(STORE_KEY, JSON.stringify({ ...getParticipant(), ...data }));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function showToast(message) {
  let toast = document.querySelector(".toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.className = "toast";
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function localPassHref(passHref) {
  const fallback = "../pass/";
  if (!passHref) return fallback;

  try {
    const url = new URL(passHref, window.location.href);
    const token = url.searchParams.get("token");
    return token ? `${fallback}?token=${encodeURIComponent(token)}` : fallback;
  } catch {
    return fallback;
  }
}

function initRegistration() {
  let step = 1;
  let selectedCompany = null;
  const state = {};
  const steps = [...document.querySelectorAll(".form-step")];
  const pills = [...document.querySelectorAll(".step-pill")];
  const next = document.querySelector("[data-next]");
  const back = document.querySelector("[data-back]");
  const submit = document.querySelector("[data-submit]");
  const companyInput = document.getElementById("company");
  const companyEmbed = document.getElementById("company360Embed");
  const companyEmbedShell = document.getElementById("companyEmbedShell");
  const noCompany = document.getElementById("noCompany");
  const contextTitle = document.getElementById("registrationContextTitle");
  const contextDescription = document.getElementById("registrationContextDescription");
  const contextByStep = {
    1: {
      title: "Rezervē<br>savu vietu.",
      description: "Trīs īsi soļi līdz dalībai AI Reality Check 2026."
    },
    2: {
      title: "Kur jūs<br>esat<br>šobrīd?",
      description: "Viena atbilde veidos konferences auditorijas kopējo AI Reality Check."
    },
    3: {
      title: "Izvēlies<br>savu<br>pieeju.",
      description: "Pilna pieeja nav obligāta. Pasākuma laikā varēsi turpināt arī anonīmi."
    }
  };

  if (companyEmbed) {
    const embedKey = window.C360_EMBED_API_KEY || "PASTE_API_KEY_HERE";
    companyEmbed.src = `https://company360.lv/embed/company-search?api_key=${encodeURIComponent(embedKey)}`;
  }

  function setCompanyEmbedDisabled(disabled) {
    companyEmbedShell?.classList.toggle("is-disabled", disabled);
    companyEmbed?.setAttribute("tabindex", disabled ? "-1" : "0");
  }

  function updateStep() {
    steps.forEach((el) => el.classList.toggle("is-active", Number(el.dataset.step) === step));
    pills.forEach((el) => {
      const n = Number(el.dataset.step);
      el.classList.toggle("is-active", n === step);
      el.classList.toggle("is-done", n < step);
      el.setAttribute("aria-current", n === step ? "step" : "false");
    });
    back.hidden = step === 1;
    next.hidden = step === 3;
    submit.hidden = step !== 3;
    if (contextTitle) contextTitle.innerHTML = contextByStep[step].title;
    if (contextDescription) contextDescription.textContent = contextByStep[step].description;
    validate();
  }

  function errorFor(id, message = "") {
    const el = document.querySelector(`[data-error-for="${id}"]`);
    if (el) el.textContent = message;
  }

  function fieldValue(id) {
    return (document.getElementById(id)?.value || "").trim();
  }

  function validate() {
    let ok = true;
    document.querySelectorAll(".field-error").forEach((el) => { el.textContent = ""; });

    if (step === 1) {
      ["firstName", "lastName", "email"].forEach((id) => {
        if (!fieldValue(id)) {
          errorFor(id, "Šis lauks ir obligāts.");
          ok = false;
        }
      });
      if (fieldValue("email") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fieldValue("email"))) {
        errorFor("email", "Ievadiet derīgu darba e-pastu.");
        ok = false;
      }
      if (!noCompany.checked && !selectedCompany && !fieldValue("company")) {
        errorFor("company", "Izvēlieties uzņēmumu vai atzīmējiet, ka to neatrodat.");
        ok = false;
      }
    }

    if (step === 2 && !document.querySelector("input[name='aiStage']:checked")) {
      ok = false;
    }

    if (step === 3 && !document.getElementById("requiredConsent").checked) {
      ok = false;
    }

    next.disabled = !ok;
    submit.disabled = !ok;
    return ok;
  }

  function collect() {
    state.firstName = fieldValue("firstName");
    state.lastName = fieldValue("lastName");
    state.email = fieldValue("email");
    state.role = fieldValue("role") || "Dalībnieks";
    state.companyName = noCompany.checked ? "Nepārstāv uzņēmumu" : (selectedCompany?.name || fieldValue("company"));
    state.company = selectedCompany;
    state.noCompany = noCompany.checked;
    state.aiStage = document.querySelector("input[name='aiStage']:checked")?.value || "";
    state.aiAnonymous = document.getElementById("aiAnonymous").checked;
    state.publicCompany = document.getElementById("publicCompany").checked;
    state.fullPortal = document.getElementById("fullPortal").checked;
    state.networking = document.getElementById("networking").checked;
    state.newsletter = document.getElementById("newsletter").checked;
    state.status = "Pieteikums saņemts";
    state.access = state.fullPortal ? "Pilnā pieeja" : "Pamata pieeja";
    state.passId = `ARC-2026-${Math.random().toString(16).slice(2, 6).toUpperCase()}`;
  }

  window.addEventListener("message", (event) => {
    if (
      event.origin !== "https://company360.lv"
      || event.source !== companyEmbed?.contentWindow
      || !event.data
    ) return;

    if (event.data.type === "company360.company_selected") {
      const company = event.data.company || {};
      selectedCompany = {
        name: company.name || "",
        reg: String(company.regcode || ""),
        registration_number: String(company.regcode || ""),
        country: company.country_code || "LV",
        country_code: company.country_code || "LV",
        address: company.address || "",
        legal_form: company.legal_form || "",
        status: company.status || "",
        url: company.url || "",
      };
      companyInput.value = selectedCompany.name;
      noCompany.checked = false;
      setCompanyEmbedDisabled(false);
      companyEmbedShell?.classList.add("has-selection");
      validate();
    }

    if (event.data.type === "company360.company_manual_entry") {
      selectedCompany = null;
      companyInput.value = (event.data.query || "").trim();
      noCompany.checked = false;
      setCompanyEmbedDisabled(false);
      companyEmbedShell?.classList.add("has-selection");
      validate();
    }
  });

  document.querySelectorAll("input, textarea").forEach((el) => el.addEventListener("input", validate));
  document.querySelectorAll("input[type='checkbox'], input[type='radio']").forEach((el) => el.addEventListener("change", validate));
  noCompany?.addEventListener("change", () => {
    setCompanyEmbedDisabled(noCompany.checked);
    if (noCompany.checked) {
      companyInput.value = "";
      selectedCompany = null;
      companyEmbedShell?.classList.remove("has-selection");
    }
    validate();
  });

  next?.addEventListener("click", () => {
    if (!validate()) return;
    collect();
    step = Math.min(3, step + 1);
    updateStep();
  });

  back?.addEventListener("click", () => {
    step = Math.max(1, step - 1);
    updateStep();
  });

  submit?.addEventListener("click", async () => {
    if (!validate()) return;
    collect();
    submit.disabled = true;
    submit.textContent = "Nosūta...";
    try {
      const result = await createRegistration(state);
      saveParticipant({
        ...state,
        participantId: result.participant?.id,
        status: "Pieteikums saņemts",
        passLink: result.links?.pass
      });
      document.querySelector(".registration-form").hidden = true;
      document.querySelector(".confirmation").classList.add("is-visible");
      document.querySelector(".registration-workspace")?.classList.add("is-confirmed");
      back.hidden = true;
      if (contextTitle) contextTitle.innerHTML = "Reģistrācija<br>pabeigta.";
      if (contextDescription) {
        contextDescription.textContent = "Tavs pieteikums AI Reality Check 2026 ir veiksmīgi saņemts.";
      }
      setText("registrationAfterTitle", "30. septembrī");
      setText("registrationAfterDescription", "Tiekamies Rīgas Motormuzejā.");
      setText("confirmationName", `Paldies, ${state.firstName}!`);
      setText("confirmationStatus", "Pieteikums saņemts");
      const passLink = document.getElementById("confirmationPassLink");
      const localPass = localPassHref(result.links?.pass);
      if (passLink) passLink.href = localPass;
      const navCta = document.getElementById("registrationNavCta");
      if (navCta) {
        navCta.href = localPass;
        navCta.innerHTML = 'Mans AI Pass <span aria-hidden="true">→</span>';
      }
      showToast(result.local ? "Pieteikums saglabāts šajā pārlūkā." : "Pieteikums nosūtīts.");
    } catch (error) {
      showToast(error.message || "Reģistrāciju neizdevās nosūtīt.");
      submit.disabled = false;
      submit.textContent = "Pabeigt reģistrāciju";
    }
  });

  updateStep();
}

async function initPass() {
  const token = new URLSearchParams(window.location.search).get("token");
  applyWalletLinks(token);
  initAddToCalendar();
  initNetworkingPass(token);
  let p = getParticipant();
  try {
    p = await fetchParticipantPass(token);
    saveParticipant(p);
  } catch (error) {
    showToast(error.message || "AI Pass neizdevās ielādēt.");
  }
  setText("passName", `${p.firstName} ${p.lastName}`);
  setText("passCompany", p.companyName);
  setText("passRole", p.role);
  setText("passStatus", p.status);
  setText("passAccess", p.access);
  setText("passId", p.passId);
  setText("aiStage", p.aiStage);

  const activate = document.getElementById("activatePortal");
  activate?.addEventListener("click", () => {
    saveParticipant({ access: "Pilnā pieeja", fullPortal: true });
    setText("passAccess", "Pilnā pieeja");
    showToast("Pilnā konferences pieredze aktivizēta.");
  });

  document.querySelectorAll("[data-toggle-pref]").forEach((button) => {
    button.addEventListener("click", () => {
      button.classList.toggle("is-active");
      showToast("Izvēle atjaunināta.");
    });
  });
}

function setActiveTab(name) {
  document.querySelectorAll(".tab-btn, [data-live-tab]").forEach((button) => {
    const target = button.dataset.liveTab || button.dataset.tab;
    button.classList.toggle("is-active", target === name);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === name);
  });
}

function formatTimeRange(item) {
  if (!item) return "";
  const start = item.time || "";
  const end = new Intl.DateTimeFormat("lv-LV", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Riga",
  }).format(new Date(item.ends_at));
  return `${start}-${end}`;
}

async function fetchLiveState() {
  if (!API_BASE) return null;
  const response = await fetch(`${API_BASE}/live-state`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Live programmu neizdevās ielādēt.");
  return data;
}

function renderLiveProgram(agenda) {
  const list = document.getElementById("liveProgramList");
  if (!list || !agenda?.length) return;

  list.innerHTML = agenda.map((item) => {
    const cls = item.status === "now"
      ? "is-now"
      : item.status === "next"
        ? "is-next"
        : item.status === "done"
          ? "is-done"
          : item.is_break
            ? "is-break"
            : "";
    const label = item.is_break
      ? "Pauze"
      : item.status === "now"
        ? "Šobrīd"
        : item.status === "next"
          ? "Tālāk"
          : item.status === "done"
            ? "Pabeigts"
            : "Vēlāk";
    const meta = [item.speaker_name, item.speaker_company].filter(Boolean).join(" · ") || item.description;
    return `
      <button class="program-item ${cls}" type="button" data-agenda-id="${item.id}" aria-label="Atvērt programmas punktu: ${item.title}">
        <span class="time">${item.time}</span>
        <div>
          <span class="program-type">${item.is_break ? "Pauze" : item.status === "now" ? "Live" : "Programma"}</span>
          <strong>${item.title}</strong>
          <p>${meta || ""}</p>
        </div>
        <span class="program-state">${item.status === "now" ? "<i></i>" : ""}${label} <b>→</b></span>
      </button>
    `;
  }).join("");
}

function questionCardsMarkup(questions) {
  if (!questions.length) return `<p class="live-empty">Vēl nav apstiprinātu jautājumu.</p>`;
  return questions.map((question) => `
      <article class="question-card">
        <button class="vote-btn" type="button" data-question-vote="${question.id}" aria-label="Atbalstīt jautājumu">
          <span>▲</span><strong>${question.vote_count || 0}</strong>
        </button>
        <div>
          <strong>${question.body}</strong>
          <span>${question.is_anonymous ? "Anonīms" : "Dalībnieks"} · ${question.status === "answered" ? "Atbildēts" : "Apstiprināts"}</span>
        </div>
      </article>
    `).join("");
}

function renderLiveQuestions(questions) {
  document.querySelectorAll("[data-live-questions]").forEach((container) => {
    container.innerHTML = questionCardsMarkup(questions);
  });
  setText("liveNowQuestionCount", `${questions.length} ${questions.length === 1 ? "jautājums" : "jautājumi"}`);
  setText("liveNowQuestionMeta", questions[0]?.body || "Uzdod jautājumu pašreizējam runātājam.");
}

function renderPollResultSet(result, container) {
  container.innerHTML = `
    <span class="live-kicker">Rezultāti · ${result.total_votes || 0} atbildes</span>
    <h3>${result.poll.title}</h3>
    <div class="meter">
      ${result.options.map((option) => `
        <div class="meter-row">
          <span>${option.label}</span>
          <span class="meter-track"><span class="meter-fill" style="--value:${option.percent || 0}%"></span></span>
          <strong>${option.percent || 0}%</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function renderLivePolls(state) {
  const active = state?.active;
  const pollCard = document.getElementById("liveActivePoll");
  const resultsBox = document.getElementById("livePollResults");
  const resultsPanel = document.getElementById("liveResultsList");

  if (pollCard) {
    if (!active) {
      pollCard.innerHTML = `<span class="live-kicker">Balsojumi</span><h2>Pašlaik nav aktīva balsojuma</h2><p class="live-empty">Kad moderators aktivizēs balsojumu, tas parādīsies šeit.</p>`;
      setText("livePollQuestionMirror", "Pašlaik nav aktīva balsojuma.");
      setText("liveNowPollTitle", "Gaida aktīvo balsojumu");
      setText("liveNowPollMeta", "Rezultāti būs pieejami pēc balsojuma.");
    } else {
      setText("livePollQuestionMirror", active.poll.title);
      setText("liveNowPollTitle", active.poll.title);
      setText("liveNowPollMeta", `${active.total_votes || 0} dalībnieki jau atbildējuši.`);
      pollCard.innerHTML = `
        <header><strong>Izvēlies vienu atbildi</strong><span>1 no 1</span></header>
        ${active.options.map((option) => `
          <button class="poll-option" type="button" data-poll-id="${active.poll.id}" data-option-id="${option.id}">
            <span class="poll-letter">${String.fromCharCode(65 + active.options.indexOf(option))}</span>
            <strong>${option.label}</strong>
            <i></i>
          </button>
        `).join("")}
        <label class="poll-anonymous"><input type="checkbox"> Atbildēt anonīmi</label>
        <button class="live-submit" type="button" disabled>Iesniegt atbildi <span>→</span></button>
      `;
    }
  }

  if (resultsBox && active) renderPollResultSet(active, resultsBox);

  if (resultsPanel) {
    const results = state?.results || [];
    resultsPanel.innerHTML = results.length
      ? results.map((result) => `<article class="live-result-card" data-result-poll="${result.poll.id}"></article>`).join("")
      : `<article class="live-result-empty"><span>Rezultāti</span><h2>Publicētu rezultātu vēl nav</h2></article>`;
    const totalVotes = results.reduce((sum, result) => sum + Number(result.total_votes || 0), 0);
    setText("liveResultScore", results.length && totalVotes
      ? Math.min(100, Math.round(totalVotes / results.length))
      : "--");
    results.forEach((result) => {
      const container = resultsPanel.querySelector(`[data-result-poll="${result.poll.id}"]`);
      if (container) renderPollResultSet(result, container);
    });
  }
}

function renderPublicResults(data, target) {
  if (!target) return;
  if (!data) {
    target.innerHTML = `<article class="card"><h2>Rezultāti nav pieejami.</h2></article>`;
    return;
  }
  const segments = data.company_segments || {};
  target.innerHTML = `
    <article class="card is-accent">
      <span class="eyebrow">Kopējais AI Reality Check</span>
      <h2>${data.summary?.headline || "Rezultāti tiks publicēti drīzumā."}</h2>
      <p class="fine">${data.summary?.participant_count || 0} dalībnieki · ${data.summary?.represented_companies || 0} uzņēmumi</p>
    </article>
    ${(data.polls || []).map((result) => `<article class="card" data-public-result="${result.poll.id}"></article>`).join("")}
    <article class="card">
      <span class="eyebrow">Company360 griezumi</span>
      <h2>Agregēti segmenti</h2>
      <p class="fine">Segmenti tiek rādīti tikai grupām ar vismaz 3 uzņēmumiem.</p>
      <div class="grid three">
        <div><strong>Nozares</strong><p class="fine">${(segments.industries || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
        <div><strong>Lielums</strong><p class="fine">${(segments.sizes || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
        <div><strong>Reģioni</strong><p class="fine">${(segments.regions || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
      </div>
    </article>
  `;
  (data.polls || []).forEach((result) => {
    const container = target.querySelector(`[data-public-result="${result.poll.id}"]`);
    if (container) renderPollResultSet(result, container);
  });
}

function applyLiveState(state) {
  const current = state?.current;
  const next = state?.next;
  if (current) {
    setText("liveCurrentTime", `● Live · ${current.time}`);
    setText("liveCurrentDuration", formatTimeRange(current));
    setText("liveCurrentTitle", current.title);
    const speaker = [current.speaker_name, current.speaker_company].filter(Boolean).join(" · ");
    setText("liveCurrentDescription", [speaker, current.description].filter(Boolean).join(". "));
    setText("liveProgramCurrentTime", `● Šobrīd · ${current.time}`);
    setText("liveProgramRemaining", formatTimeRange(current));
    setText("liveProgramCurrentTitle", current.title);
    setText("liveProgramCurrentMeta", [speaker, current.description].filter(Boolean).join(". "));
    setText("liveQuestionAgenda", `Jautājums tiks piesaistīts prezentācijai “${current.title}”.`);
    setText("livePollAgenda", current.title);
    setText("livePollSpeaker", speaker || "Atbildi anonīmi un redzi kopējo auditorijas viedokli.");
  }
  setText("liveNextLine", next ? `Tālāk: ${next.title}, ${next.time}.` : "Tālāk: programma noslēgumā.");
  renderLiveProgram(state?.agenda || []);
}

function initLive() {
  const p = getParticipant();
  let currentAgendaItemId = null;
  let selectedAgendaItemId = null;
  let activePollId = null;
  let agendaItems = [];
  setText("liveMode", p.access === "Pilnā pieeja" ? "Pilnā pieeja" : "Pamata pieeja");
  setText("liveUser", `${p.firstName} ${p.lastName}`);

  document.querySelectorAll(".tab-btn, [data-live-tab]").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.liveTab || button.dataset.tab));
  });

  async function refreshQuestions() {
    try {
      const questions = await fetchQuestions(currentAgendaItemId);
      renderLiveQuestions(questions);
    } catch (error) {
      console.warn(error);
    }
  }

  function speakerInitials(name) {
    return (name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "AI";
  }

  function renderAgendaPolls(itemId, pollState) {
    const container = document.getElementById("agendaDetailPolls");
    if (!container) return;
    const active = pollState?.active?.poll?.agenda_item_id === itemId ? pollState.active : null;
    const published = (pollState?.results || []).filter((result) => result.poll?.agenda_item_id === itemId);
    const resultIds = new Set(published.map((result) => result.poll.id));
    const cards = [];

    if (active) {
      cards.push(`
        <article class="agenda-poll-card">
          <span class="live-status-label"><i></i> Aktīvs balsojums</span>
          <h3>${active.poll.title}</h3>
          ${active.options.map((option, index) => `
            <button class="poll-option" type="button" data-poll-id="${active.poll.id}" data-option-id="${option.id}">
              <span class="poll-letter">${String.fromCharCode(65 + index)}</span>
              <strong>${option.label}</strong>
              <i></i>
            </button>
          `).join("")}
          <button class="live-submit" type="button" disabled>Iesniegt atbildi <span>→</span></button>
        </article>
      `);
    }

    published.forEach((result) => {
      cards.push(`<article class="agenda-poll-card" data-agenda-result="${result.poll.id}"></article>`);
    });

    if (!cards.length) {
      container.innerHTML = `<p class="live-empty">Šai tēmai pašlaik nav aktīvu vai publicētu balsojumu.</p>`;
      return;
    }

    container.innerHTML = `<div class="agenda-poll-grid">${cards.join("")}</div>`;
    published.forEach((result) => {
      const target = container.querySelector(`[data-agenda-result="${result.poll.id}"]`);
      if (target) renderPollResultSet(result, target);
    });

    if (active && resultIds.has(active.poll.id)) {
      const duplicate = container.querySelector(`[data-agenda-result="${active.poll.id}"]`);
      duplicate?.remove();
    }
  }

  async function openAgendaDetail(itemId, activateView = true) {
    const item = agendaItems.find((agendaItem) => agendaItem.id === itemId);
    if (!item) return;
    selectedAgendaItemId = item.id;
    const talkIndex = agendaItems.filter((agendaItem) => !agendaItem.is_break).findIndex((agendaItem) => agendaItem.id === item.id);
    const displayNumber = item.is_break ? agendaItems.findIndex((agendaItem) => agendaItem.id === item.id) + 1 : talkIndex + 1;
    setText("agendaDetailType", item.is_break ? "Pauze" : item.status === "now" ? "Live · programmas punkts" : "Programmas punkts");
    setText("agendaDetailTime", formatTimeRange(item));
    setText("agendaDetailTitle", item.title);
    setText("agendaDetailDescription", item.description || (item.is_break ? "Laiks atelpai un sarunām ar citiem dalībniekiem." : "Plašāka informācija par šo programmas punktu tiks papildināta."));
    setText("agendaDetailSpeaker", item.speaker_name || (item.is_break ? "Konferences pauze" : "Runātājs tiks precizēts"));
    setText("agendaDetailSpeakerMeta", [item.speaker_role, item.speaker_company].filter(Boolean).join(" · "));
    setText("agendaDetailNumber", String(Math.max(displayNumber, 1)).padStart(2, "0"));

    const portrait = document.getElementById("agendaDetailPortrait");
    if (portrait) {
      portrait.innerHTML = item.speaker_image_url
        ? `<img src="${item.speaker_image_url}" alt="">`
        : `<span>${speakerInitials(item.speaker_name)}</span>`;
    }

    const interactionGrid = document.querySelector(".agenda-detail-grid");
    const pollsSection = document.querySelector(".agenda-detail-polls");
    if (interactionGrid) interactionGrid.hidden = Boolean(item.is_break);
    if (pollsSection) pollsSection.hidden = Boolean(item.is_break);
    if (activateView) {
      setActiveTab("agenda-detail");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    if (item.is_break) return;

    const questionsBox = document.getElementById("agendaDetailQuestions");
    const pollsBox = document.getElementById("agendaDetailPolls");
    if (questionsBox) questionsBox.innerHTML = `<p class="live-empty">Ielādē jautājumus...</p>`;
    if (pollsBox) pollsBox.innerHTML = `<p class="live-empty">Ielādē balsojumus...</p>`;
    try {
      const [questions, polls] = await Promise.all([fetchQuestions(item.id), fetchPollState()]);
      if (selectedAgendaItemId !== item.id) return;
      if (questionsBox) questionsBox.innerHTML = questionCardsMarkup(questions);
      renderAgendaPolls(item.id, polls);
    } catch (error) {
      if (questionsBox) questionsBox.innerHTML = `<p class="live-empty">Datus neizdevās ielādēt. Mēģini vēlreiz.</p>`;
      if (pollsBox) pollsBox.innerHTML = `<p class="live-empty">Datus neizdevās ielādēt. Mēģini vēlreiz.</p>`;
      console.warn(error);
    }
  }

  async function refreshPolls() {
    try {
      const pollState = await fetchPollState();
      const nextPollId = pollState?.active?.poll?.id || null;
      if (activePollId && nextPollId && activePollId !== nextPollId) {
        const notice = document.getElementById("livePollNotice");
        if (notice) {
          notice.hidden = false;
          window.setTimeout(() => { notice.hidden = true; }, 5000);
        }
      }
      activePollId = nextPollId;
      renderLivePolls(pollState);
    } catch (error) {
      console.warn(error);
      setText("liveSyncStatus", "Savienojums nestabils. Mēģinām vēlreiz...");
    }
  }

  async function refreshLive() {
    try {
      const state = await fetchLiveState();
      if (state) {
        currentAgendaItemId = state.current?.id || null;
        agendaItems = state.agenda || [];
        applyLiveState(state);
        setText("liveSyncStatus", "Live dati atjaunināti.");
        await refreshQuestions();
        await refreshPolls();
        if (selectedAgendaItemId) await openAgendaDetail(selectedAgendaItemId, false);
      }
    } catch (error) {
      console.warn(error);
      setText("liveSyncStatus", "Nav savienojuma. Dati tiks atkārtoti ielādēti.");
    }
  }

  refreshLive();
  window.setInterval(refreshLive, 10000);
  subscribeLiveRealtime(() => refreshLive());

  const question = document.getElementById("questionText");
  const count = document.getElementById("questionCount");
  question?.addEventListener("input", () => {
    const left = 280 - question.value.length;
    count.textContent = `${left} rakstzīmes`;
  });

  document.getElementById("sendQuestion")?.addEventListener("click", () => {
    const body = question.value.trim();
    if (!body) {
      showToast("Ierakstiet jautājumu pirms iesniegšanas.");
      return;
    }
    const isAnonymous = document.getElementById("questionAnonymous")?.checked !== false;
    submitQuestion(body, currentAgendaItemId, isAnonymous)
      .then(() => {
        question.value = "";
        count.textContent = "280 rakstzīmes";
        showToast("Jautājums iesniegts moderācijai.");
      })
      .catch((error) => showToast(error.message || "Jautājumu neizdevās iesniegt."));
  });

  const agendaQuestion = document.getElementById("agendaQuestionText");
  const agendaQuestionCount = document.getElementById("agendaQuestionCount");
  agendaQuestion?.addEventListener("input", () => {
    agendaQuestionCount.textContent = `${280 - agendaQuestion.value.length} rakstzīmes`;
  });

  document.getElementById("sendAgendaQuestion")?.addEventListener("click", () => {
    const body = agendaQuestion?.value.trim() || "";
    if (!body || !selectedAgendaItemId) {
      showToast("Ierakstiet jautājumu pirms iesniegšanas.");
      return;
    }
    const isAnonymous = document.getElementById("agendaQuestionAnonymous")?.checked !== false;
    submitQuestion(body, selectedAgendaItemId, isAnonymous)
      .then(() => {
        agendaQuestion.value = "";
        agendaQuestionCount.textContent = "280 rakstzīmes";
        showToast("Jautājums iesniegts moderācijai un piesaistīts šai tēmai.");
      })
      .catch((error) => showToast(error.message || "Jautājumu neizdevās iesniegt."));
  });

  document.getElementById("liveProgramList")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-agenda-id]");
    if (button) openAgendaDetail(button.dataset.agendaId);
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-question-vote]");
    if (!button) return;
    button.disabled = true;
    voteQuestion(button.dataset.questionVote)
      .then(() => {
        button.classList.add("is-voted");
        refreshQuestions();
        if (selectedAgendaItemId) openAgendaDetail(selectedAgendaItemId, false);
      })
      .catch((error) => {
        showToast(error.message || "Balsojumu neizdevās iesniegt.");
        button.disabled = false;
      });
  });

  document.querySelectorAll(".poll-option").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".poll-option").forEach((item) => item.classList.remove("is-selected"));
      button.classList.add("is-selected");
      document.getElementById("pollResults").hidden = false;
      showToast("Balsojums iesniegts. Atkārtota balsošana šajā sesijā ir bloķēta.");
    });
  });

  document.addEventListener("click", (event) => {
    const option = event.target.closest("[data-poll-id][data-option-id]");
    if (!option) return;
    document.querySelectorAll("[data-poll-id][data-option-id]").forEach((item) => item.classList.remove("is-selected"));
    option.classList.add("is-selected");
    const submit = option.closest("#liveActivePoll, .agenda-poll-card")?.querySelector(".live-submit");
    if (submit) {
      submit.disabled = false;
      submit.dataset.pollId = option.dataset.pollId;
      submit.dataset.optionId = option.dataset.optionId;
    }
  });

  document.addEventListener("click", (event) => {
    const submit = event.target.closest(".live-submit[data-poll-id][data-option-id]");
    if (!submit) return;
    submit.disabled = true;
    submitPollVote(submit.dataset.pollId, submit.dataset.optionId)
      .then(() => {
        showToast("Balsojums iesniegts.");
        refreshPolls();
        if (selectedAgendaItemId) openAgendaDetail(selectedAgendaItemId, false);
      })
      .catch((error) => {
        showToast(error.message || "Balsojumu neizdevās iesniegt.");
        submit.disabled = false;
      });
  });

  const params = new URLSearchParams(window.location.search);
  let networkingToken = params.get("token");
  if (!networkingToken && p.passLink) {
    try {
      networkingToken = new URL(p.passLink, window.location.href).searchParams.get("token");
    } catch {
      networkingToken = null;
    }
  }
  if (networkingToken) {
    document.querySelectorAll(".live-pass-link").forEach((link) => {
      link.href = `../pass/?token=${encodeURIComponent(networkingToken)}`;
    });
    initNetworkingPass(networkingToken);
  }

  const availableViews = ["now", "program", "questions", "polls", "results", "networking"];
  const requestedView = params.get("view");
  setActiveTab(availableViews.includes(requestedView) ? requestedView : "now");
}

function initAdmin() {
  const keyInput = document.getElementById("adminKey");
  const loadButton = document.getElementById("loadRegistrations");
  const clearButton = document.getElementById("clearAdminKey");
  const statusFilter = document.getElementById("registrationStatusFilter");
  const exportButton = document.getElementById("exportRegistrations");
  const checkinStatsButton = document.getElementById("loadCheckinStats");
  const checkinStatsBox = document.getElementById("checkinStats");
  const autoApproveEnabled = document.getElementById("autoApproveEnabled");
  const autoApproveLimit = document.getElementById("autoApproveLimit");
  const graphCalendarUser = document.getElementById("graphCalendarUser");
  const microsoftGraphEventId = document.getElementById("microsoftGraphEventId");
  const loadApprovalSettings = document.getElementById("loadApprovalSettings");
  const saveApprovalSettings = document.getElementById("saveApprovalSettings");
  const approvalSettingsStatus = document.getElementById("approvalSettingsStatus");
  const status = document.getElementById("adminStatus");
  const list = document.getElementById("adminRegistrations");
  const liveStatus = document.getElementById("adminLiveStatus");
  const liveList = document.getElementById("adminLiveAgenda");
  const loadLiveButton = document.getElementById("loadLiveAdmin");
  const saveAgendaButton = document.getElementById("saveAgendaItem");
  const questionsStatus = document.getElementById("adminQuestionsStatus");
  const questionsList = document.getElementById("adminQuestions");
  const loadQuestionsButton = document.getElementById("loadAdminQuestions");
  const questionStatusFilter = document.getElementById("questionStatusFilter");
  const questionAgendaFilter = document.getElementById("questionAgendaFilter");
  const pollsStatus = document.getElementById("adminPollsStatus");
  const pollsList = document.getElementById("adminPolls");
  const loadPollsButton = document.getElementById("loadAdminPolls");
  const createPollButton = document.getElementById("createAdminPoll");
  const pollTitle = document.getElementById("pollTitle");
  const pollOptions = document.getElementById("pollOptions");
  const pollAgendaItemId = document.getElementById("pollAgendaItemId");
  const statsBox = document.getElementById("adminStats");
  const loadStatsButton = document.getElementById("loadAdminStats");

  if (!API_BASE) {
    status.textContent = "API nav konfigurēts.";
    return;
  }

  keyInput.value = sessionStorage.getItem("arcAdminKey") || "";

  function setStatus(message) {
    status.textContent = message;
  }

  function setApprovalStatus(message) {
    if (approvalSettingsStatus) approvalSettingsStatus.textContent = message;
  }

  async function loadAutoApprovalSettings() {
    const key = keyInput.value.trim();
    if (!key) return setApprovalStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    try {
      const data = await adminRequest("/admin-registrations?action=settings");
      const settings = data.settings || {};
      if (autoApproveEnabled) autoApproveEnabled.checked = Boolean(settings.auto_approve_enabled);
      if (autoApproveLimit) autoApproveLimit.value = String(settings.auto_approve_limit || 0);
      if (graphCalendarUser) graphCalendarUser.value = settings.graph_calendar_user || "konference@animas.lv";
      if (microsoftGraphEventId) microsoftGraphEventId.value = settings.microsoft_graph_event_id || "";
      setApprovalStatus(`Apstiprināti ${settings.approved_count || 0}/${settings.capacity || 0}. Auto limits: ${settings.auto_approve_limit || 0}.`);
    } catch (error) {
      setApprovalStatus(error.message || "Iestatījumus neizdevās ielādēt.");
    }
  }

  async function saveAutoApprovalSettings() {
    const key = keyInput.value.trim();
    if (!key) return setApprovalStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    try {
      const data = await adminRequest("/admin-registrations?action=settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoApproveEnabled: Boolean(autoApproveEnabled?.checked),
          autoApproveLimit: Number(autoApproveLimit?.value || 0),
          graphCalendarUser: graphCalendarUser?.value || "",
          microsoftGraphEventId: microsoftGraphEventId?.value || "",
        }),
      });
      const settings = data.settings || {};
      setApprovalStatus(`Saglabāts. Auto ${settings.auto_approve_enabled ? "ieslēgts" : "izslēgts"}, limits ${settings.auto_approve_limit || 0}.`);
    } catch (error) {
      setApprovalStatus(error.message || "Iestatījumus neizdevās saglabāt.");
    }
  }

  function render(rows) {
    list.innerHTML = "";
    if (!rows.length) {
      list.innerHTML = `<p class="fine">Pieteikumu vēl nav.</p>`;
      return;
    }

    rows.forEach((row) => {
      const item = document.createElement("div");
      item.className = "admin-row";
      const name = `${row.first_name || ""} ${row.last_name || ""}`.trim();
      item.innerHTML = `
        <div>
          <strong>${name || row.email}</strong>
          <span class="fine">${row.email} · ${row.role || "Amats nav norādīts"} · ${row.status}</span>
        </div>
        <div class="admin-row-actions">
          <button class="btn secondary" type="button" data-approve="${row.id}" ${row.status === "approved" ? "disabled" : ""}>Apstiprināt</button>
          <button class="btn secondary" type="button" data-waitlist="${row.id}" ${row.status === "waitlisted" ? "disabled" : ""}>Gaidīšana</button>
          <button class="btn secondary" type="button" data-reject="${row.id}" ${row.status === "rejected" ? "disabled" : ""}>Atteikt</button>
          <button class="btn secondary" type="button" data-reconfirm="${row.id}">7 dienas</button>
          <button class="btn secondary" type="button" data-edit-participant="${row.id}">Labot</button>
          <button class="btn secondary" type="button" data-revoke="${row.id}">Revokēt</button>
        </div>
      `;
      list.appendChild(item);
    });
  }

  async function load() {
    const key = keyInput.value.trim();
    if (!key) {
      setStatus("Ievadi admin atslēgu.");
      return;
    }
    sessionStorage.setItem("arcAdminKey", key);
    setStatus("Ielādē...");
    try {
      const qs = statusFilter?.value && statusFilter.value !== "all" ? `?status=${encodeURIComponent(statusFilter.value)}` : "";
      const data = await adminRequest(`/admin-registrations${qs}`);
      render(data.registrations || []);
      setStatus(`Ielādēti pieteikumi: ${(data.registrations || []).length}`);
    } catch (error) {
      setStatus(error.message || "Neizdevās ielādēt pieteikumus.");
    }
  }

  loadButton?.addEventListener("click", load);
  loadApprovalSettings?.addEventListener("click", loadAutoApprovalSettings);
  saveApprovalSettings?.addEventListener("click", saveAutoApprovalSettings);
  statusFilter?.addEventListener("change", load);
  exportButton?.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) return setStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    const qs = statusFilter?.value && statusFilter.value !== "all" ? `&status=${encodeURIComponent(statusFilter.value)}` : "";
    try {
      const response = await fetch(`${API_BASE}/admin-registrations?action=export${qs}`, {
        headers: { "x-admin-key": key },
      });
      if (!response.ok) throw new Error("CSV eksportu neizdevās sagatavot.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ai-reality-check-registrations.csv";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setStatus(error.message || "CSV eksportu neizdevās sagatavot.");
    }
  });
  checkinStatsButton?.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key || !checkinStatsBox) return setStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    try {
      const data = await adminRequest("/admin-registrations?action=stats");
      checkinStatsBox.innerHTML = `
        <article class="card"><span class="eyebrow">Ieradušies</span><h2>${data.arrived || 0}</h2></article>
        <article class="card"><span class="eyebrow">Apstiprināti</span><h2>${data.approved || 0}</h2></article>
        <article class="card"><span class="eyebrow">Check-in skeni</span><h2>${data.checkins || 0}</h2></article>
        <article class="card"><span class="eyebrow">Dublikāti</span><h2>${data.duplicate_scans || 0}</h2></article>
      `;
    } catch (error) {
      setStatus(error.message || "Check-in statistiku neizdevās ielādēt.");
    }
  });
  clearButton?.addEventListener("click", () => {
    sessionStorage.removeItem("arcAdminKey");
    keyInput.value = "";
    list.innerHTML = "";
    setStatus("Atslēga notīrīta.");
  });

  list?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-approve],[data-waitlist],[data-reject],[data-reconfirm],[data-edit-participant],[data-revoke]");
    if (!button) return;
    if (button.dataset.editParticipant) {
      const row = button.closest(".admin-row");
      const current = row?.querySelector("strong")?.textContent?.split(" ") || [];
      const email = row?.querySelector(".fine")?.textContent?.split(" · ")[0] || "";
      const firstName = prompt("Vārds", current[0] || "");
      if (firstName === null) return;
      const lastName = prompt("Uzvārds", current.slice(1).join(" ") || "");
      if (lastName === null) return;
      const updatedEmail = prompt("E-pasts", email);
      if (updatedEmail === null) return;
      const role = prompt("Amats", "");
      try {
        await adminRequest(`/admin-registrations?action=update&participant_id=${button.dataset.editParticipant}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ firstName, lastName, email: updatedEmail, role }),
        });
        showToast("Dalībnieka dati atjaunināti.");
        await load();
      } catch (error) {
        showToast(error.message || "Datus neizdevās saglabāt.");
      }
      return;
    }

    const action = button.dataset.approve
      ? "approve"
      : button.dataset.waitlist
        ? "waitlist"
        : button.dataset.reject
          ? "reject"
          : button.dataset.reconfirm
            ? "reconfirm"
            : button.dataset.revoke
              ? "revoke-tokens"
              : "";
    const participantId = button.dataset.approve || button.dataset.waitlist || button.dataset.reject || button.dataset.reconfirm || button.dataset.revoke;
    if (!action || !participantId) return;
    button.disabled = true;
    button.textContent = "Saglabā...";
    try {
      await adminRequest(`/admin-registrations?action=${action}&participant_id=${participantId}`, {
        method: "POST"
      });
      showToast("Dalībnieka statuss atjaunināts.");
      await load();
    } catch (error) {
      showToast(error.message || "Darbība neizdevās.");
      button.disabled = false;
      button.textContent = "Mēģināt vēlreiz";
    }
  });

  function setLiveStatus(message) {
    if (liveStatus) liveStatus.textContent = message;
  }

  function renderLiveAdmin(state) {
    if (!liveList) return;
    const agenda = state?.agenda || [];
    renderPollAgendaOptions(agenda);
    if (!agenda.length) {
      liveList.innerHTML = `<p class="fine">Programma vēl nav ielādēta.</p>`;
      return;
    }
    liveList.innerHTML = agenda.map((item) => `
      <div class="admin-row">
        <div>
          <strong>${item.time} · ${item.title}</strong>
          <span class="fine">${item.is_break ? "Pauze" : item.status}${item.speaker_name ? ` · ${item.speaker_name}` : ""}</span>
        </div>
        <div class="admin-row-actions">
          <button class="btn secondary" type="button" data-current-agenda="${item.id}" ${item.is_break || item.status === "now" ? "disabled" : ""}>Pārslēgt uz šobrīd</button>
        </div>
      </div>
    `).join("");
  }

  async function loadLiveAdmin() {
    const key = keyInput.value.trim();
    if (!key) return setLiveStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    setLiveStatus("Ielādē programmu...");
    try {
      const state = await fetchLiveState();
      renderLiveAdmin(state);
      setLiveStatus(state?.current ? `Šobrīd: ${state.current.title}` : "Nav aktīva programmas punkta.");
    } catch (error) {
      setLiveStatus(error.message || "Programmu neizdevās ielādēt.");
    }
  }

  loadLiveButton?.addEventListener("click", loadLiveAdmin);
  saveAgendaButton?.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    if (!key) return setLiveStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    const starts = document.getElementById("agendaStarts")?.value;
    const ends = document.getElementById("agendaEnds")?.value;
    const title = document.getElementById("agendaTitle")?.value.trim();
    if (!starts || !ends || !title) return setLiveStatus("Aizpildi sākumu, beigas un nosaukumu.");
    try {
      await adminRequest("/admin-live?action=upsert-agenda", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          startsAt: new Date(starts).toISOString(),
          endsAt: new Date(ends).toISOString(),
          description: document.getElementById("agendaDescription")?.value || "",
          speakerName: document.getElementById("agendaSpeaker")?.value || "",
          speakerRole: document.getElementById("agendaSpeakerRole")?.value || "",
          speakerCompany: document.getElementById("agendaSpeakerCompany")?.value || "",
          speakerImageUrl: document.getElementById("agendaSpeakerImageUrl")?.value || "",
          materialsUrl: document.getElementById("agendaMaterialsUrl")?.value || "",
          videoUrl: document.getElementById("agendaVideoUrl")?.value || "",
          displayOrder: Date.now(),
        }),
      });
      showToast("Programmas punkts saglabāts.");
      await loadLiveAdmin();
    } catch (error) {
      setLiveStatus(error.message || "Programmas punktu neizdevās saglabāt.");
    }
  });
  liveList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-current-agenda]");
    if (!button) return;
    button.disabled = true;
    button.textContent = "Pārslēdz...";
    try {
      await adminRequest(`/admin-live?action=set-current&agenda_item_id=${button.dataset.currentAgenda}`, {
        method: "POST"
      });
      showToast("Live programmas punkts pārslēgts.");
      await loadLiveAdmin();
    } catch (error) {
      showToast(error.message || "Neizdevās pārslēgt programmu.");
      button.disabled = false;
      button.textContent = "Pārslēgt uz šobrīd";
    }
  });

  function setQuestionsStatus(message) {
    if (questionsStatus) questionsStatus.textContent = message;
  }

  function renderAdminQuestions(rows) {
    if (!questionsList) return;
    if (!rows.length) {
      questionsList.innerHTML = `<p class="fine">Jautājumu vēl nav.</p>`;
      return;
    }
    questionsList.innerHTML = rows.map((question) => `
      <div class="admin-row">
        <div>
          <strong>${question.body}</strong>
          <span class="fine">${question.status} · balsis ${question.vote_count || 0} · ${question.is_anonymous ? "Anonīms" : "Ar vārdu"}</span>
        </div>
        <div class="admin-row-actions">
          <button class="btn secondary" type="button" data-question-status="approved" data-question-id="${question.id}" ${question.status === "approved" ? "disabled" : ""}>Apstiprināt</button>
          <button class="btn secondary" type="button" data-question-status="answered" data-question-id="${question.id}" ${question.status === "answered" ? "disabled" : ""}>Atbildēts</button>
          <button class="btn secondary" type="button" data-question-status="hidden" data-question-id="${question.id}" ${question.status === "hidden" ? "disabled" : ""}>Paslēpt</button>
        </div>
      </div>
    `).join("");
  }

  async function loadAdminQuestions() {
    const key = keyInput.value.trim();
    if (!key) return setQuestionsStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    setQuestionsStatus("Ielādē jautājumus...");
    try {
      if (questionAgendaFilter && questionAgendaFilter.dataset.loaded !== "true") {
        const liveState = await fetchLiveState();
        renderPollAgendaOptions(liveState?.agenda || []);
      }
      const params = new URLSearchParams();
      if (questionStatusFilter?.value && questionStatusFilter.value !== "all") params.set("status", questionStatusFilter.value);
      if (questionAgendaFilter?.value && questionAgendaFilter.value !== "all") params.set("agenda_item_id", questionAgendaFilter.value);
      const data = await adminRequest(`/admin-questions${params.toString() ? `?${params}` : ""}`);
      renderAdminQuestions(data.questions || []);
      setQuestionsStatus(`Jautājumi: ${(data.questions || []).length}`);
    } catch (error) {
      setQuestionsStatus(error.message || "Jautājumus neizdevās ielādēt.");
    }
  }

  loadQuestionsButton?.addEventListener("click", loadAdminQuestions);
  questionStatusFilter?.addEventListener("change", loadAdminQuestions);
  questionAgendaFilter?.addEventListener("change", loadAdminQuestions);
  questionsList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-question-status]");
    if (!button) return;
    button.disabled = true;
    try {
      await adminRequest(`/admin-questions?question_id=${button.dataset.questionId}&status=${button.dataset.questionStatus}`, {
        method: "POST"
      });
      showToast("Jautājums atjaunināts.");
      await loadAdminQuestions();
    } catch (error) {
      showToast(error.message || "Jautājumu neizdevās atjaunināt.");
      button.disabled = false;
    }
  });

  function setPollsStatus(message) {
    if (pollsStatus) pollsStatus.textContent = message;
  }

  function renderPollAgendaOptions(agenda) {
    const talkItems = (agenda || []).filter((item) => !item.is_break);
    if (pollAgendaItemId && pollAgendaItemId.dataset.loaded !== "true") {
      pollAgendaItemId.innerHTML = `<option value="">Nav piesaistīts</option>${talkItems.map((item) => (
        `<option value="${item.id}">${item.time} · ${item.title}</option>`
      )).join("")}`;
      pollAgendaItemId.dataset.loaded = "true";
    }
    if (questionAgendaFilter && questionAgendaFilter.dataset.loaded !== "true") {
      questionAgendaFilter.innerHTML = `<option value="all">Visi</option>${talkItems.map((item) => (
        `<option value="${item.id}">${item.time} · ${item.title}</option>`
      )).join("")}`;
      questionAgendaFilter.dataset.loaded = "true";
    }
  }

  function renderAdminPolls(rows) {
    if (!pollsList) return;
    if (!rows.length) {
      pollsList.innerHTML = `<p class="fine">Balsojumu vēl nav.</p>`;
      return;
    }
    pollsList.innerHTML = rows.map((poll) => `
      <div class="admin-row">
        <div>
          <strong>${poll.title}</strong>
          <span class="fine">${poll.status} · rezultāti ${poll.results_public ? "publicēti" : "nav publicēti"}</span>
        </div>
        <div class="admin-row-actions">
          <button class="btn secondary" type="button" data-poll-action="activate" data-poll-id="${poll.id}" ${poll.status === "active" ? "disabled" : ""}>Aktivizēt</button>
          <button class="btn secondary" type="button" data-poll-action="close" data-poll-id="${poll.id}" ${poll.status === "closed" ? "disabled" : ""}>Slēgt</button>
          <button class="btn secondary" type="button" data-poll-action="publish" data-poll-id="${poll.id}" ${poll.results_public ? "disabled" : ""}>Publicēt</button>
        </div>
      </div>
    `).join("");
  }

  async function loadAdminPolls() {
    const key = keyInput.value.trim();
    if (!key) return setPollsStatus("Ievadi admin atslēgu.");
    sessionStorage.setItem("arcAdminKey", key);
    setPollsStatus("Ielādē balsojumus...");
    try {
      if (pollAgendaItemId && pollAgendaItemId.dataset.loaded !== "true") {
        const liveState = await fetchLiveState();
        renderPollAgendaOptions(liveState?.agenda || []);
      }
      const data = await adminRequest("/admin-polls");
      renderAdminPolls(data.polls || []);
      setPollsStatus(`Balsojumi: ${(data.polls || []).length}`);
    } catch (error) {
      setPollsStatus(error.message || "Balsojumus neizdevās ielādēt.");
    }
  }

  loadPollsButton?.addEventListener("click", loadAdminPolls);
  createPollButton?.addEventListener("click", async () => {
    const key = keyInput.value.trim();
    const title = pollTitle?.value.trim() || "";
    const options = (pollOptions?.value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (!key) return setPollsStatus("Ievadi admin atslēgu.");
    if (!title) return setPollsStatus("Ievadi balsojuma jautājumu.");
    if (options.length < 2) return setPollsStatus("Ievadi vismaz divus atbilžu variantus.");
    sessionStorage.setItem("arcAdminKey", key);
    createPollButton.disabled = true;
    try {
      await adminRequest("/admin-polls?action=create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          options,
          agendaItemId: pollAgendaItemId?.value.trim() || undefined,
        }),
      });
      if (pollTitle) pollTitle.value = "";
      if (pollOptions) pollOptions.value = "";
      if (pollAgendaItemId) pollAgendaItemId.value = "";
      showToast("Balsojums izveidots.");
      await loadAdminPolls();
    } catch (error) {
      setPollsStatus(error.message || "Balsojumu neizdevās izveidot.");
    } finally {
      createPollButton.disabled = false;
    }
  });

  pollsList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-poll-action]");
    if (!button) return;
    button.disabled = true;
    try {
      await adminRequest(`/admin-polls?action=${button.dataset.pollAction}&poll_id=${button.dataset.pollId}`, {
        method: "POST"
      });
      showToast("Balsojums atjaunināts.");
      await loadAdminPolls();
    } catch (error) {
      showToast(error.message || "Balsojumu neizdevās atjaunināt.");
      button.disabled = false;
    }
  });

  loadStatsButton?.addEventListener("click", async () => {
    if (!statsBox) return;
    statsBox.innerHTML = `<article class="card"><p class="fine">Ielādē...</p></article>`;
    try {
      const data = await fetchResults();
      statsBox.innerHTML = `
        <article class="card"><span class="eyebrow">Dalībnieki</span><h2>${data.summary?.participant_count || 0}</h2></article>
        <article class="card"><span class="eyebrow">Uzņēmumi</span><h2>${data.summary?.represented_companies || 0}</h2></article>
        <article class="card"><span class="eyebrow">MI izmanto/testē</span><h2>${data.summary?.using_ai_percent || 0}%</h2></article>
        <article class="card"><span class="eyebrow">Publicēti balsojumi</span><h2>${(data.polls || []).length}</h2></article>
      `;
    } catch (error) {
      statsBox.innerHTML = `<article class="card"><p class="fine">${error.message || "Statistiku neizdevās ielādēt."}</p></article>`;
    }
  });
}

function initResults() {
  const target = document.getElementById("publicResults");
  fetchResults()
    .then((data) => renderPublicResults(data, target))
    .catch((error) => {
      if (target) target.innerHTML = `<article class="card"><h2>Rezultātus neizdevās ielādēt.</h2><p class="fine">${error.message}</p></article>`;
    });
}

function initArchive() {
  const target = document.getElementById("archiveContent");
  fetchArchive()
    .then((data) => {
      if (!target) return;
      const agenda = data?.agenda || [];
      const questions = data?.questions || [];
      target.innerHTML = `
        <article class="card is-accent">
          <span class="eyebrow">Kopsavilkums</span>
          <h2>${data?.results?.summary?.headline || "Arhīvs tiks papildināts pēc konferences."}</h2>
          <p class="fine">${data?.results?.summary?.participant_count || 0} dalībnieki · ${data?.results?.summary?.represented_companies || 0} uzņēmumi</p>
        </article>
        <article class="card">
          <span class="eyebrow">Programma</span>
          <h2>Materiāli un video</h2>
          <div class="program-list">
            ${agenda.map((item) => `
              <div class="program-item">
                <span class="time">${new Intl.DateTimeFormat("lv-LV", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(new Date(item.starts_at))}</span>
                <div><strong>${item.title}</strong><p class="fine">${[item.speaker_name, item.speaker_company].filter(Boolean).join(" · ") || item.description || ""}</p></div>
                <span class="tag">${item.materials_url || item.video_url ? "Materiāli" : "Arhīvs"}</span>
              </div>
              ${(item.materials_url || item.video_url) ? `<div class="btn-row"><a class="btn secondary" href="${item.materials_url || "#"}">Prezentācija</a><a class="btn secondary" href="${item.video_url || "#"}">Video</a></div>` : ""}
            `).join("")}
          </div>
        </article>
        <article class="card">
          <span class="eyebrow">Atbildētie jautājumi</span>
          <h2>${questions.length}</h2>
          <div class="grid">${questions.map((q) => `<article class="question-card"><strong>${q.body}</strong><span class="fine">Balsis ${q.vote_count || 0}</span></article>`).join("") || `<p class="fine">Atbildēto jautājumu vēl nav.</p>`}</div>
        </article>
      `;
    })
    .catch((error) => {
      if (target) target.innerHTML = `<article class="card"><h2>Arhīvu neizdevās ielādēt.</h2><p class="fine">${error.message}</p></article>`;
    });
}

async function checkinRequest(path, options = {}) {
  const adminKey = sessionStorage.getItem("arcAdminKey") || "";
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "x-admin-key": adminKey,
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Check-in pieprasījums neizdevās.");
  return data;
}

function initCheckin() {
  const keyInput = document.getElementById("checkinAdminKey");
  const tokenInput = document.getElementById("checkinToken");
  const previewButton = document.getElementById("previewCheckin");
  const confirmButton = document.getElementById("confirmCheckin");
  const status = document.getElementById("checkinStatus");
  const result = document.getElementById("checkinResult");
  const params = new URLSearchParams(window.location.search);

  keyInput.value = sessionStorage.getItem("arcAdminKey") || "";
  tokenInput.value = params.get("token") || "";

  function setStatus(message) {
    status.textContent = message;
  }

  function currentToken() {
    return tokenInput.value.trim();
  }

  function saveKey() {
    const key = keyInput.value.trim();
    if (key) sessionStorage.setItem("arcAdminKey", key);
    return key;
  }

  function renderParticipant(data) {
    const p = data.participant;
    const tone = data.result === "accepted"
      ? "is-ok"
      : p.duplicate || data.result === "duplicate"
        ? "is-warning"
        : data.result === "invalid_status"
          ? "is-error"
          : "";
    result.innerHTML = `
      <div class="checkin-card ${tone}">
        <span class="status-chip ${p.status === "arrived" ? "is-ok" : ""}">${p.status_label}</span>
        <h2 style="margin-bottom:0">${p.name}</h2>
        <p class="muted" style="margin-bottom:0">${p.company_name}</p>
        <p class="fine" style="margin-bottom:0">${p.email}${p.role ? ` · ${p.role}` : ""}</p>
        ${p.duplicate || data.result === "duplicate" ? `<strong style="color:var(--yellow)">QR jau ir izmantots.</strong>` : ""}
        ${data.result === "invalid_status" ? `<strong style="color:var(--red)">Dalībnieka statuss neļauj veikt check-in.</strong>` : ""}
      </div>
    `;
  }

  async function preview() {
    if (!API_BASE) return setStatus("API nav konfigurēts.");
    if (!saveKey()) return setStatus("Ievadi admin atslēgu.");
    if (!currentToken()) return setStatus("Nav QR tokena.");
    confirmButton.disabled = true;
    setStatus("Pārbauda...");
    try {
      const data = await checkinRequest(`/checkin-scan?token=${encodeURIComponent(currentToken())}`);
      renderParticipant(data);
      confirmButton.disabled = data.participant?.duplicate || !["approved", "reconfirm_required"].includes(data.participant?.status);
      setStatus(data.participant?.duplicate ? "QR jau izmantots." : "Dalībnieks atrasts.");
    } catch (error) {
      result.innerHTML = "";
      setStatus(error.message || "Pārbaude neizdevās.");
    }
  }

  async function confirm() {
    if (!saveKey()) return setStatus("Ievadi admin atslēgu.");
    if (!currentToken()) return setStatus("Nav QR tokena.");
    confirmButton.disabled = true;
    confirmButton.textContent = "Apstiprina...";
    try {
      const data = await checkinRequest("/checkin-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: currentToken(),
          deviceLabel: navigator.userAgent.slice(0, 120)
        })
      });
      renderParticipant(data);
      setStatus(data.result === "accepted" ? "Ierašanās apstiprināta." : "Check-in netika pieņemts.");
      showToast(data.result === "accepted" ? "Dalībnieks atzīmēts kā ieradies." : "QR netika pieņemts.");
    } catch (error) {
      setStatus(error.message || "Check-in neizdevās.");
      confirmButton.disabled = false;
    } finally {
      confirmButton.textContent = "Apstiprināt ierašanos";
    }
  }

  previewButton?.addEventListener("click", preview);
  confirmButton?.addEventListener("click", confirm);
  if (currentToken() && keyInput.value.trim()) preview();
}

document.addEventListener("DOMContentLoaded", () => {
  const page = document.body.dataset.page;
  if (page === "registration") initRegistration();
  if (page === "pass") initPass();
  if (page === "live") initLive();
  if (page === "admin") initAdmin();
  if (page === "checkin") initCheckin();
  if (page === "results") initResults();
  if (page === "archive") initArchive();
});
