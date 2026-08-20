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
  if (apple) {
    apple.removeAttribute("aria-disabled");
    apple.href = `${API_BASE}/wallet?provider=apple&token=${encodeURIComponent(token)}`;
    apple.addEventListener("click", (event) => {
      event.preventDefault();
      if (apple.getAttribute("aria-disabled") === "true") return;
      apple.setAttribute("aria-disabled", "true");
      fetch(apple.href)
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.shareUrl) {
            throw new Error(data.error || "Apple Wallet biļeti pašlaik neizdevās izveidot. Lūdzu, mēģiniet vēlreiz.");
          }
          window.open(data.shareUrl, "_blank", "noopener");
        })
        .catch((error) => showToast(error.message || "Apple Wallet biļeti pašlaik neizdevās izveidot. Lūdzu, mēģiniet vēlreiz."))
        .finally(() => apple.removeAttribute("aria-disabled"));
    });
  }
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
  const role = document.getElementById("networkingRole");
  const phone = document.getElementById("networkingPhone");
  const discuss = document.getElementById("networkingDiscuss");
  const looking = document.getElementById("networkingLooking");
  const offer = document.getElementById("networkingOffer");
  const profilesBox = document.getElementById("networkingProfiles");
  const requestsBox = document.getElementById("networkingRequests");

  function renderNetworking(data) {
    if (visible) visible.checked = Boolean(data.profile?.is_visible);
    if (role) role.value = data.participant?.role || "";
    if (phone) phone.value = data.profile?.phone || "";
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
          ].filter(Boolean).join(" · ") || "Papildini profilu augšā, lai citi dalībnieki vieglāk atrastu kopīgas tēmas."}</p>
        </article>
      ` : "";
      const otherProfiles = profiles.map((profile) => `
        <article class="card">
          <strong>${profile.name}</strong>
          <p class="fine">${[profile.role, profile.company, profile.email, profile.phone].filter(Boolean).join(" · ")}</p>
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
        role: role?.value || "",
        phone: phone?.value || "",
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
  if (!API_BASE) return { active: null, activePolls: [], results: [] };
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

async function submitPollVote(pollId, answer) {
  const response = await fetch(`${API_BASE}/polls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pollId,
      optionId: answer?.optionId,
      optionIds: answer?.optionIds,
      responseText: answer?.responseText,
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
    .on("broadcast", { event: "presentation_changed" }, onMessage)
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

function trackMaturityEvent(eventName, overrides = {}) {
  if (!API_BASE) return;
  const slider = document.getElementById("maturitySlider");
  const level = overrides.maturityLevel ?? Number(slider?.value || 0);
  const levelInfo = window.maturityLevelByNumber ? window.maturityLevelByNumber(level) : null;
  const properties = {
    registrationStep: 2,
    maturityLevel: level,
    maturityPhase: overrides.maturityPhase ?? (levelInfo?.phase || ""),
    anonymous: overrides.anonymous ?? (document.getElementById("aiAnonymous")?.checked !== false),
  };
  try {
    fetch(`${API_BASE}/analytics-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventName, properties }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort analytics only
  }
}

function initMaturityGauge(onChange) {
  const slider = document.getElementById("maturitySlider");
  const levels = window.MATURITY_LEVELS;
  if (!slider || !levels) return;

  const visual = document.querySelector(".maturity-gauge-visual");
  const numbersBox = document.getElementById("maturityNumbers");
  const activeDot = document.getElementById("maturityActiveDot");
  const activeNumber = document.getElementById("maturityActiveNumber");
  const fillArc = document.getElementById("maturityFillArc");
  const image = document.getElementById("maturityImage");
  const placeholder = document.getElementById("maturityPlaceholder");
  const cardLevel = document.getElementById("maturityCardLevel");
  const cardPhase = document.getElementById("maturityCardPhase");
  const cardTitle = document.getElementById("maturityCardTitle");
  const cardDescription = document.getElementById("maturityCardDescription");
  const phaseTrack = document.querySelector(".maturity-phase-track");

  const count = levels.length;
  const viewBoxSize = 520;
  const cx = 260;
  const cy = 260;
  const r = 210;
  const startDeg = 145;
  const sweepDeg = 250;
  const arcLength = fillArc ? fillArc.getTotalLength() : 0;
  let currentLevel = Number(slider.value);
  let imageSwapTimer = null;

  function pointForIndex(index) {
    const deg = startDeg + (sweepDeg * index) / (count - 1);
    const rad = (deg * Math.PI) / 180;
    return {
      xPct: ((cx + r * Math.cos(rad)) / viewBoxSize) * 100,
      yPct: ((cy + r * Math.sin(rad)) / viewBoxSize) * 100,
    };
  }

  function levelFromAngle(clientX, clientY) {
    if (!visual) return Number(slider.value);
    const rect = visual.getBoundingClientRect();
    const originX = rect.left + rect.width / 2;
    const originY = rect.top + rect.height / 2;
    let angle = (Math.atan2(clientY - originY, clientX - originX) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    if (angle > 35 && angle < 145) angle = angle <= 90 ? 35 : 145;
    const normalized = angle < 145 ? angle + 360 : angle;
    const fraction = Math.min(1, Math.max(0, (normalized - startDeg) / sweepDeg));
    const index = Math.round(fraction * (count - 1));
    return levels[index].level;
  }

  if (numbersBox && !numbersBox.dataset.built) {
    numbersBox.innerHTML = levels
      .map((item, index) => {
        const { xPct, yPct } = pointForIndex(index);
        return `<button type="button" class="maturity-gauge-number" data-level="${item.level}" style="left:${xPct}%;top:${yPct}%">${item.level}</button>`;
      })
      .join("");
    numbersBox.dataset.built = "true";
  }

  function setImage(info) {
    if (!image) return;
    window.clearTimeout(imageSwapTimer);
    image.classList.add("is-leaving");
    imageSwapTimer = window.setTimeout(() => {
      image.onerror = () => {
        image.hidden = true;
        if (placeholder) placeholder.hidden = false;
      };
      image.onload = () => {
        image.hidden = false;
        if (placeholder) placeholder.hidden = true;
      };
      image.alt = info.title;
      image.src = info.imageUrl;
      image.classList.remove("is-leaving");
    }, 120);
  }

  function applyLevel(level, { silent = false } = {}) {
    const info = window.maturityLevelByNumber(level) || levels[0];
    const index = levels.indexOf(info);
    const { xPct, yPct } = pointForIndex(index);

    if (activeDot) {
      activeDot.style.left = `${xPct}%`;
      activeDot.style.top = `${yPct}%`;
    }
    if (activeNumber) activeNumber.textContent = String(info.level);

    if (fillArc && arcLength) {
      const fraction = index / (count - 1);
      fillArc.style.strokeDasharray = String(arcLength);
      fillArc.style.strokeDashoffset = String(arcLength * (1 - fraction));
    }

    if (info.level !== currentLevel || silent) setImage(info);
    currentLevel = info.level;
    if (placeholder) placeholder.textContent = String(info.level);

    if (cardLevel) cardLevel.textContent = String(info.level);
    if (cardPhase) cardPhase.textContent = info.phase;
    if (cardTitle) cardTitle.textContent = info.title;
    if (cardDescription) cardDescription.textContent = info.description;

    numbersBox?.querySelectorAll("[data-level]").forEach((button) => {
      const buttonLevel = Number(button.dataset.level);
      button.classList.toggle("is-current", buttonLevel === info.level);
      button.classList.toggle("is-passed", buttonLevel < info.level);
    });

    if (phaseTrack) {
      phaseTrack.querySelectorAll(".maturity-tick").forEach((tick) => {
        tick.classList.toggle("is-active", tick.dataset.phase === info.phase);
      });
    }

    if (!silent && onChange) onChange(info.level);
  }

  let sliderDebounce = null;
  slider.addEventListener("input", () => {
    applyLevel(Number(slider.value));
    window.clearTimeout(sliderDebounce);
    sliderDebounce = window.setTimeout(() => trackMaturityEvent("maturity_slider_changed"), 200);
  });
  slider.addEventListener("change", () => {
    trackMaturityEvent("maturity_level_selected");
  });

  numbersBox?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-level]");
    if (!button) return;
    slider.value = button.dataset.level;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    slider.focus();
  });

  let dragPointerId = null;

  function applyPointerLevel(clientX, clientY) {
    const level = levelFromAngle(clientX, clientY);
    if (String(level) !== slider.value) {
      slider.value = String(level);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  visual?.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-level]")) return;
    dragPointerId = event.pointerId;
    visual.setPointerCapture(event.pointerId);
    slider.focus({ preventScroll: true });
    applyPointerLevel(event.clientX, event.clientY);
    event.preventDefault();
  });

  visual?.addEventListener("pointermove", (event) => {
    if (dragPointerId !== event.pointerId) return;
    applyPointerLevel(event.clientX, event.clientY);
  });

  function endGaugeDrag(event) {
    if (dragPointerId !== event.pointerId) return;
    dragPointerId = null;
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }

  visual?.addEventListener("pointerup", endGaugeDrag);
  visual?.addEventListener("pointercancel", endGaugeDrag);

  applyLevel(Number(slider.value), { silent: true });
}

// Phone validation rules by country code
const PHONE_RULES = {
  // Baltic States
  "371": { country: "Latvia", minDigits: 8, maxDigits: 8 },
  "370": { country: "Lithuania", minDigits: 8, maxDigits: 8 },
  "372": { country: "Estonia", minDigits: 8, maxDigits: 8 },
  // Southern Europe
  "34": { country: "Spain", minDigits: 9, maxDigits: 9 },
  "351": { country: "Portugal", minDigits: 9, maxDigits: 9 },
  "39": { country: "Italy", minDigits: 9, maxDigits: 10 },
  "30": { country: "Greece", minDigits: 10, maxDigits: 10 },
  "357": { country: "Cyprus", minDigits: 8, maxDigits: 8 },
  "356": { country: "Malta", minDigits: 8, maxDigits: 8 },
  // Central Europe
  "48": { country: "Poland", minDigits: 9, maxDigits: 9 },
  "420": { country: "Czechia", minDigits: 9, maxDigits: 9 },
  "421": { country: "Slovakia", minDigits: 9, maxDigits: 9 },
  "36": { country: "Hungary", minDigits: 9, maxDigits: 9 },
  "40": { country: "Romania", minDigits: 9, maxDigits: 9 },
  "385": { country: "Croatia", minDigits: 9, maxDigits: 10 },
  "386": { country: "Slovenia", minDigits: 8, maxDigits: 9 },
  // Western Europe
  "49": { country: "Germany", minDigits: 10, maxDigits: 11 },
  "33": { country: "France", minDigits: 9, maxDigits: 9 },
  "31": { country: "Netherlands", minDigits: 9, maxDigits: 9 },
  "32": { country: "Belgium", minDigits: 9, maxDigits: 9 },
  "352": { country: "Luxembourg", minDigits: 9, maxDigits: 11 },
  "41": { country: "Switzerland", minDigits: 9, maxDigits: 9 },
  "43": { country: "Austria", minDigits: 10, maxDigits: 13 },
  // Northern Europe
  "45": { country: "Denmark", minDigits: 8, maxDigits: 8 },
  "46": { country: "Sweden", minDigits: 9, maxDigits: 9 },
  "358": { country: "Finland", minDigits: 9, maxDigits: 9 },
  // British Isles
  "44": { country: "United Kingdom", minDigits: 10, maxDigits: 10 },
  "353": { country: "Ireland", minDigits: 9, maxDigits: 10 },
  // North America
  "1": { country: "USA/Canada", minDigits: 10, maxDigits: 10 },
  "1-CA": { country: "Canada", minDigits: 10, maxDigits: 10 }
};

function formatPhoneNumber(digits, countryCode) {
  if (!digits) return "";
  const rules = PHONE_RULES[countryCode] || PHONE_RULES["371"];
  // Only format if digits meet minimum requirement
  if (digits.length < rules.minDigits) return "";
  // For Canada (1-CA), format as +1 with digits
  const prefix = countryCode === "1-CA" ? "1" : countryCode;
  return `+${prefix} ${digits}`;
}

function validatePhoneNumber(phoneDigits, countryCode) {
  const rules = PHONE_RULES[countryCode];
  if (!rules) return "Valsts kods nav atpazīts.";
  if (phoneDigits.length < rules.minDigits) {
    return `${rules.country} numuram ir jābūt vismaz ${rules.minDigits} cipari (ievadīts: ${phoneDigits.length})`;
  }
  if (phoneDigits.length > rules.maxDigits) {
    return `${rules.country} numuram ir jābūt maksimāli ${rules.maxDigits} cipari (ievadīts: ${phoneDigits.length})`;
  }
  return null;
}

function initRegistration() {
  let step = 1;
  let selectedCompany = null;
  let maturityStepSeen = false;
  const state = {};
  const steps = [...document.querySelectorAll(".form-step")];
  const pills = [...document.querySelectorAll(".step-pill")];
  const next = document.querySelector("[data-next]");
  const back = document.querySelector("[data-back]");
  const submit = document.querySelector("[data-submit]");
  const phoneCountrySelect = document.getElementById("phoneCountry");
  const phoneInput = document.getElementById("phone");
  const companyInput = document.getElementById("company");
  const companyEmbed = document.getElementById("company360Embed");
  const companyEmbedShell = document.getElementById("companyEmbedShell");
  const companySelectedChip = document.getElementById("companySelectedChip");
  const companySelectedName = document.getElementById("companySelectedName");
  const companySelectedChange = document.getElementById("companySelectedChange");
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

  function resetCompanyEmbed() {
    if (!companyEmbed) return;
    const embedKey = window.C360_EMBED_API_KEY || "PASTE_API_KEY_HERE";
    companyEmbed.src = `https://company360.lv/embed/company-search?api_key=${encodeURIComponent(embedKey)}`;
  }

  function showCompanySelection(name) {
    if (companySelectedName) companySelectedName.textContent = name;
    companySelectedChip?.removeAttribute("hidden");
    companyEmbedShell?.classList.add("has-selection");
  }

  function hideCompanySelection() {
    companySelectedChip?.setAttribute("hidden", "");
    companyEmbedShell?.classList.remove("has-selection");
  }

  resetCompanyEmbed();

  function setCompanyEmbedDisabled(disabled) {
    companyEmbedShell?.classList.toggle("is-disabled", disabled);
    companyEmbed?.setAttribute("tabindex", disabled ? "-1" : "0");
  }

  companySelectedChange?.addEventListener("click", () => {
    selectedCompany = null;
    companyInput.value = "";
    hideCompanySelection();
    resetCompanyEmbed();
    validate();
  });

  function updateStep() {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
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
    next.textContent = step === 2 ? "Apstiprināt līmeni" : "Turpināt";
    const submitFootnote = document.getElementById("submitFootnote");
    if (submitFootnote) submitFootnote.hidden = step !== 3;
    if (step === 2 && !maturityStepSeen) {
      maturityStepSeen = true;
      trackMaturityEvent("maturity_step_viewed");
    }
    if (contextTitle) contextTitle.innerHTML = contextByStep[step].title;
    if (contextDescription) contextDescription.textContent = contextByStep[step].description;
    validate();
    const card = document.querySelector(".registration-card");
    if (card) {
      const top = window.scrollY + card.getBoundingClientRect().top - 24;
      window.scrollTo({ top: Math.max(0, top), behavior: "auto" });
    }
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
        errorFor("email", "Ievadiet derīgu e-pastu.");
        ok = false;
      }

      // Phone validation
      const phoneDigits = fieldValue("phone").replace(/\D/g, "");
      const countryCode = phoneCountrySelect?.value || "371";
      if (!phoneDigits) {
        errorFor("phone", "Šis lauks ir obligāts.");
        ok = false;
      } else {
        const phoneError = validatePhoneNumber(phoneDigits, countryCode);
        if (phoneError) {
          errorFor("phone", phoneError);
          ok = false;
        }
      }

      if (!noCompany.checked && !selectedCompany && !fieldValue("company")) {
        errorFor("company", "Izvēlieties uzņēmumu vai atzīmējiet, ka to neatrodat.");
        ok = false;
      }
    }

    if (step === 2) {
      const maturityLevel = Number(document.getElementById("maturitySlider")?.value);
      if (!Number.isInteger(maturityLevel) || maturityLevel < 1 || maturityLevel > 10) {
        ok = false;
      }
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
    const phoneDigits = fieldValue("phone").replace(/\D/g, "");
    const countryCode = phoneCountrySelect?.value || "371";
    state.phone = formatPhoneNumber(phoneDigits, countryCode);
    state.role = fieldValue("role") || "Dalībnieks";
    state.companyName = noCompany.checked ? "Nepārstāv uzņēmumu" : (selectedCompany?.name || fieldValue("company"));
    state.company = selectedCompany;
    state.noCompany = noCompany.checked;
    state.aiMaturityLevel = Number(document.getElementById("maturitySlider")?.value || 0);
    // Backward compatibility for the currently deployed registrations function,
    // which still validates the former four-stage `aiStage` field.
    const maturityPhase = window.maturityLevelByNumber?.(state.aiMaturityLevel)?.phase;
    state.aiStage = {
      "Izpēte": "Vēl neizmantojam",
      "Eksperimenti": "Izmēģinām atsevišķus rīkus",
      "Ieviešana": "Izmantojam vairākos procesos",
      "Līderis": "MI ir daļa no uzņēmuma stratēģijas",
    }[maturityPhase] || "Izmēģinām atsevišķus rīkus";
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
      showCompanySelection(selectedCompany.name);
      validate();
    }

    if (event.data.type === "company360.company_manual_entry") {
      selectedCompany = null;
      companyInput.value = (event.data.query || "").trim();
      noCompany.checked = false;
      setCompanyEmbedDisabled(false);
      showCompanySelection(companyInput.value);
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
      hideCompanySelection();
    }
    validate();
  });

  next?.addEventListener("click", () => {
    if (!validate()) return;
    collect();
    if (step === 2) {
      trackMaturityEvent(state.aiAnonymous ? "maturity_answer_submitted_anonymously" : "maturity_answer_submitted");
    }
    step = Math.min(3, step + 1);
    updateStep();
  });

  back?.addEventListener("click", () => {
    if (step === 2) trackMaturityEvent("maturity_step_abandoned");
    step = Math.max(1, step - 1);
    updateStep();
  });

  submit?.addEventListener("click", async () => {
    if (!validate()) return;
    collect();
    console.log("Registration state:", state);
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

  initMaturityGauge(validate);

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

async function fetchLiveState() {
  if (!API_BASE) return null;
  const response = await fetch(`${API_BASE}/live-state`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Live programmu neizdevās ielādēt.");
  return data;
}

function agendaSignature(agenda) {
  return (agenda || []).map((item) => `${item.id}:${item.status}`).join("|");
}

function renderLiveProgram(agenda) {
  const list = document.getElementById("liveProgramList");
  if (!list || !agenda?.length) return;

  list.innerHTML = agenda.filter((item) => item.status !== "cancelled").map((item) => {
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
    const meta = [item.speaker_name, item.speaker_company, item.speaker_role].filter(Boolean).join(" · ") || item.description;
    const actions = item.is_break ? "" : `
      <div class="agenda-actions">
        <button class="agenda-action" type="button" data-agenda-action="questions" data-agenda-id="${item.id}" aria-expanded="false" aria-label="Jautāt par: ${item.title}">
          <span class="agenda-action-icon" aria-hidden="true">?</span>Jautāt <b data-question-count="${item.id}">0</b>
        </button>
        <button class="agenda-action" type="button" data-agenda-action="polls" data-agenda-id="${item.id}" aria-expanded="false" aria-label="Balsot par: ${item.title}">
          <span class="agenda-action-icon" aria-hidden="true">▤</span>Balsot <b class="agenda-live-badge" data-poll-live="${item.id}" hidden>LIVE</b>
        </button>
      </div>`;
    return `
      <article class="program-item ${cls}" data-agenda-item="${item.id}">
        <div class="program-item-row">
          <span class="time">${item.time}</span>
          <div class="program-item-body">
            <span class="program-type">${item.is_break ? "Pauze" : item.status === "now" ? "Live" : item.category || "Programma"}</span>
            <strong>${item.title}</strong>
            <p>${meta || ""}</p>
          </div>
          <div class="program-item-side">
            <span class="program-state">${item.status === "now" ? "<i></i>" : ""}${label}</span>
            ${actions}
          </div>
        </div>
        ${item.is_break ? "" : `<div class="agenda-expand" data-agenda-expand="${item.id}" hidden></div>`}
      </article>
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

function wordCloudMarkup(responses) {
  if (!responses.length) return `<p class="live-empty">Vēl nav atbilžu.</p>`;
  const counts = new Map();
  responses.forEach((text) => {
    text.toLowerCase().split(/\s+/).filter((word) => word.length > 2).forEach((word) => {
      counts.set(word, (counts.get(word) || 0) + 1);
    });
  });
  const max = Math.max(1, ...counts.values());
  const words = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
  return `<div class="word-cloud">${words.map(([word, count]) => {
    const size = 12 + Math.round((count / max) * 28);
    return `<span style="font-size:${size}px">${word}</span>`;
  }).join(" ")}</div>`;
}

function textResponseListMarkup(responses) {
  if (!responses.length) return `<p class="live-empty">Vēl nav atbilžu.</p>`;
  return `<ul class="poll-text-list">${responses.map((text) => `<li>${text}</li>`).join("")}</ul>`;
}

function renderPollResultSet(result, container) {
  if (result.text_responses) {
    container.innerHTML = `
      <span class="live-kicker">Rezultāti · ${result.total_votes || 0} atbildes</span>
      <h3>${result.poll.title}</h3>
      ${result.poll.poll_type === "word_cloud" ? wordCloudMarkup(result.text_responses) : textResponseListMarkup(result.text_responses)}
    `;
    return;
  }
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

function readinessLabel(percent) {
  if (percent >= 75) return "Aktīvi ievieš MI";
  if (percent >= 50) return "Praktiski ieinteresēti";
  if (percent >= 25) return "Izzina iespējas";
  return "Sākuma posmā";
}

function renderResultsSection(data) {
  const intro = document.getElementById("resultsIntro");
  const scoreRing = document.getElementById("resultsScoreRing");
  const scoreValue = document.getElementById("resultsScoreValue");
  const scoreLabel = document.getElementById("resultsScoreLabel");
  const highlights = document.getElementById("resultsHighlights");
  const pollList = document.getElementById("resultsPollList");
  const segmentsBox = document.getElementById("resultsSegments");
  const maturityBox = document.getElementById("resultsMaturity");

  const summary = data?.summary || {};
  const segments = data?.company_segments || {};
  const maturity = data?.maturity || {};
  const polls = data?.polls || [];
  const hasData = Boolean(summary.participant_count);
  const score = Number(summary.using_ai_percent || 0);

  if (intro) {
    intro.textContent = hasData
      ? `Ko par MI domā ${summary.participant_count} konferences dalībnieki no ${summary.represented_companies || 0} Latvijas uzņēmumiem un organizācijām.`
      : (summary.headline || "Rezultāti tiks publicēti drīzumā.");
  }
  if (scoreRing) scoreRing.style.setProperty("--score", score);
  if (scoreValue) scoreValue.textContent = hasData ? String(score) : "--";
  if (scoreLabel) scoreLabel.textContent = hasData ? readinessLabel(score) : "Ielādē datus...";

  if (highlights) {
    const tiles = polls.filter((result) => result.top).slice(0, 3);
    highlights.hidden = !tiles.length;
    highlights.innerHTML = tiles.map((result) => `
      <article class="results-tile">
        <strong>${result.top.percent || 0}%</strong>
        <span>${result.top.label}</span>
        <small>${result.poll.title}</small>
      </article>
    `).join("");
  }

  if (pollList) {
    pollList.innerHTML = polls.length
      ? polls.map((result, index) => `
        <article class="results-poll-card">
          <span class="live-kicker">${String(index + 1).padStart(2, "0")} · MI auditorijas balsojums</span>
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
          <small class="results-poll-meta">${result.total_votes || 0} atbildes</small>
        </article>
      `).join("")
      : `<article class="results-empty"><span>Rezultāti</span><h2>Publicētu balsojumu vēl nav</h2></article>`;
  }

  if (segmentsBox) {
    segmentsBox.innerHTML = `
      <div><strong>Nozares</strong><p class="fine">${(segments.industries || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
      <div><strong>Lielums</strong><p class="fine">${(segments.sizes || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
      <div><strong>Reģioni</strong><p class="fine">${(segments.regions || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
    `;
  }

  if (maturityBox) {
    const answeredCount = Number(maturity.answered_count || 0);
    maturityBox.hidden = !answeredCount;
    if (answeredCount) {
      const byLevel = maturity.by_level || [];
      maturityBox.innerHTML = `
        <span class="eyebrow">MI brieduma līmenis</span>
        <h2>Kur atrodas konferences dalībnieki</h2>
        <div class="grid two maturity-stats-grid">
          <div><strong>${maturity.average ?? "--"}/10</strong><p class="fine">Vidējais līmenis</p></div>
          <div><strong>${maturity.median ?? "--"}/10</strong><p class="fine">Mediāna</p></div>
        </div>
        <div class="meter">
          ${byLevel.map((row) => {
            const info = window.maturityLevelByNumber ? window.maturityLevelByNumber(row.level) : null;
            const percent = answeredCount ? Math.round((row.count / answeredCount) * 100) : 0;
            return `
              <div class="meter-row">
                <span>${row.level} · ${info?.title || ""}</span>
                <span class="meter-track"><span class="meter-fill" style="--value:${percent}%"></span></span>
                <strong>${row.count}</strong>
              </div>
            `;
          }).join("")}
        </div>
        <div class="grid three results-segments-grid">
          <div><strong>Posmi</strong><p class="fine">${(maturity.by_phase || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
          <div><strong>Nozares</strong><p class="fine">${(maturity.by_industry || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
          <div><strong>Lielums</strong><p class="fine">${(maturity.by_size || []).map((x) => `${x.label} (${x.count})`).join("<br>") || "Nav pietiekamu datu"}</p></div>
        </div>
      `;
    }
  }
}

function initLive() {
  const p = getParticipant();
  let agendaItems = [];
  let lastAgendaSignature = "";
  let questionsByItem = new Map();
  let latestPollState = null;
  let openExpand = null;
  let activeQuestionFilter = "top";

  setText("liveMode", p.access === "Pilnā pieeja" ? "Pilnā pieeja" : "Pamata pieeja");
  setText("liveUser", `${p.firstName} ${p.lastName}`);

  document.querySelectorAll(".tab-btn, [data-live-tab]").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.liveTab || button.dataset.tab));
  });

  function myQuestionIds() {
    try {
      return new Set(JSON.parse(localStorage.getItem("arcMyQuestionIds") || "[]"));
    } catch {
      return new Set();
    }
  }

  function rememberMyQuestion(id) {
    const ids = myQuestionIds();
    ids.add(id);
    localStorage.setItem("arcMyQuestionIds", JSON.stringify([...ids]));
  }

  function agendaExpandQuestionsMarkup() {
    return `
      <div class="live-question-layout">
        <article class="live-question-form">
          <span class="live-kicker">Jautā runātājam</span>
          <h2>Ko vēlies uzzināt?</h2>
          <p>Jautājums automātiski tiks piesaistīts šim programmas punktam.</p>
          <textarea data-role="question-input" maxlength="280" placeholder="Ieraksti savu jautājumu..."></textarea>
          <div class="live-question-meta">
            <span data-role="question-count">280 rakstzīmes</span>
            <label><input type="checkbox" data-role="question-anon" checked> Iesniegt anonīmi</label>
          </div>
          <button class="live-submit" type="button" data-role="question-submit">Iesniegt jautājumu <span>→</span></button>
        </article>
        <section class="live-audience-questions">
          <div class="agenda-question-tabs">
            <button type="button" class="is-active" data-role="question-filter" data-filter="top">Populārākie</button>
            <button type="button" data-role="question-filter" data-filter="mine">Mani jautājumi</button>
          </div>
          <div data-role="question-list"><p class="live-empty">Ielādē jautājumus...</p></div>
        </section>
      </div>
    `;
  }

  function renderQuestionListInto(container, itemId, filter) {
    if (!container) return;
    const all = questionsByItem.get(itemId) || [];
    if (filter === "mine") {
      const mine = myQuestionIds();
      const list = all.filter((question) => mine.has(question.id));
      container.innerHTML = list.length
        ? questionCardsMarkup(list)
        : `<p class="live-empty">Tu vēl neesi uzdevis jautājumu šai tēmai.</p>`;
      return;
    }
    container.innerHTML = questionCardsMarkup(all);
  }

  function agendaPollMarkup(itemId, pollState) {
    const activeForItem = (pollState?.activePolls || []).filter((result) => result.poll?.agenda_item_id === itemId);
    const activeIds = new Set(activeForItem.map((result) => result.poll.id));
    const published = (pollState?.results || [])
      .filter((result) => result.poll?.agenda_item_id === itemId && !activeIds.has(result.poll.id));

    if (!activeForItem.length && !published.length) {
      return `<p class="live-empty">Šai tēmai pašlaik nav aktīvu vai publicētu balsojumu.</p>`;
    }

    const cards = [];
    activeForItem.forEach((active) => {
      const pollType = active.poll.poll_type;
      const isText = pollType === "open_text" || pollType === "word_cloud";
      const isMulti = pollType === "multiple_choice";
      const body = isText
        ? `
          <textarea class="poll-text-input" maxlength="280" placeholder="Ieraksti savu atbildi..."></textarea>
          <button class="live-submit" type="button" data-role="poll-text-submit" data-poll-id="${active.poll.id}">Iesniegt atbildi <span>→</span></button>
        `
        : `
          ${active.options.map((option, index) => `
            <button class="poll-option" type="button" data-poll-id="${active.poll.id}" data-option-id="${option.id}" data-multi="${isMulti}">
              <span class="poll-letter">${String.fromCharCode(65 + index)}</span>
              <strong>${option.label}</strong>
              <i></i>
            </button>
          `).join("")}
          <label class="poll-anonymous"><input type="checkbox" checked disabled> Atbilde vienmēr anonīma</label>
          <button class="live-submit" type="button" disabled data-role="poll-option-submit">Iesniegt atbildi <span>→</span></button>
        `;
      cards.push(`
        <article class="agenda-poll-card">
          <span class="live-status-label"><i></i> Aktīvs balsojums</span>
          <h3>${active.poll.title}</h3>
          ${body}
        </article>
      `);
    });
    published.forEach((result) => {
      cards.push(`<article class="agenda-poll-card" data-agenda-result="${result.poll.id}"></article>`);
    });
    return `<div class="agenda-poll-grid">${cards.join("")}</div>`;
  }

  function fillPollPanel(itemId, container) {
    if (!container) return;
    container.innerHTML = agendaPollMarkup(itemId, latestPollState);
    (latestPollState?.results || [])
      .filter((result) => result.poll?.agenda_item_id === itemId)
      .forEach((result) => {
        const target = container.querySelector(`[data-agenda-result="${result.poll.id}"]`);
        if (target) renderPollResultSet(result, target);
      });
  }

  function fillExpandContent(itemId, mode) {
    const card = document.querySelector(`.program-item[data-agenda-item="${itemId}"]`);
    const panel = card?.querySelector("[data-agenda-expand]");
    if (!panel) return;
    if (mode === "questions") {
      renderQuestionListInto(panel.querySelector('[data-role="question-list"]'), itemId, activeQuestionFilter);
    } else {
      fillPollPanel(itemId, panel.querySelector('[data-role="poll-panel"]'));
    }
  }

  function setExpandChrome(itemId, mode, isOpen) {
    const card = document.querySelector(`.program-item[data-agenda-item="${itemId}"]`);
    if (!card) return;
    card.classList.toggle("is-expanded", isOpen);
    card.querySelectorAll("[data-agenda-action]").forEach((btn) => {
      const active = isOpen && btn.dataset.agendaAction === mode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-expanded", String(active));
    });
  }

  function closeAgendaExpand() {
    if (!openExpand) return;
    const { itemId } = openExpand;
    const card = document.querySelector(`.program-item[data-agenda-item="${itemId}"]`);
    const panel = card?.querySelector("[data-agenda-expand]");
    setExpandChrome(itemId, null, false);
    if (panel) {
      panel.hidden = true;
      panel.innerHTML = "";
    }
    openExpand = null;
  }

  async function openAgendaExpand(itemId, mode) {
    if (openExpand && openExpand.itemId === itemId && openExpand.mode === mode) {
      closeAgendaExpand();
      return;
    }
    if (openExpand) closeAgendaExpand();

    const card = document.querySelector(`.program-item[data-agenda-item="${itemId}"]`);
    const panel = card?.querySelector("[data-agenda-expand]");
    if (!card || !panel) return;

    openExpand = { itemId, mode };
    activeQuestionFilter = "top";
    setExpandChrome(itemId, mode, true);
    panel.hidden = false;
    panel.innerHTML = mode === "questions"
      ? agendaExpandQuestionsMarkup()
      : `<div class="live-loading" data-role="poll-loading">Ielādē balsojumu...</div><div class="agenda-poll-panel" data-role="poll-panel" hidden></div>`;

    if (mode === "polls" && !latestPollState) {
      try {
        latestPollState = await fetchPollState();
      } catch (error) {
        console.warn(error);
      }
    }
    if (!openExpand || openExpand.itemId !== itemId || openExpand.mode !== mode) return;
    if (mode === "polls") {
      panel.querySelector('[data-role="poll-loading"]')?.remove();
      const box = panel.querySelector('[data-role="poll-panel"]');
      if (box) box.hidden = false;
    }
    fillExpandContent(itemId, mode);
  }

  function restoreOpenExpandAfterRerender() {
    if (!openExpand) return;
    const { itemId, mode } = openExpand;
    const card = document.querySelector(`.program-item[data-agenda-item="${itemId}"]`);
    const panel = card?.querySelector("[data-agenda-expand]");
    if (!card || !panel) {
      openExpand = null;
      return;
    }
    setExpandChrome(itemId, mode, true);
    panel.hidden = false;
    panel.innerHTML = mode === "questions"
      ? agendaExpandQuestionsMarkup()
      : `<div class="agenda-poll-panel" data-role="poll-panel"></div>`;
    fillExpandContent(itemId, mode);
  }

  function updateAgendaBadges() {
    document.querySelectorAll("[data-question-count]").forEach((el) => {
      el.textContent = String((questionsByItem.get(el.dataset.questionCount) || []).length);
    });
    document.querySelectorAll("[data-poll-live]").forEach((el) => {
      el.hidden = !(latestPollState?.activePolls || []).some((result) => result.poll?.agenda_item_id === el.dataset.pollLive);
    });
  }

  async function refreshQuestions() {
    try {
      const all = await fetchQuestions();
      questionsByItem = new Map();
      all.forEach((question) => {
        const key = question.agenda_item_id || "";
        if (!questionsByItem.has(key)) questionsByItem.set(key, []);
        questionsByItem.get(key).push(question);
      });
      updateAgendaBadges();
      if (openExpand?.mode === "questions") fillExpandContent(openExpand.itemId, "questions");
    } catch (error) {
      console.warn(error);
    }
  }

  async function refreshPolls() {
    try {
      latestPollState = await fetchPollState();
      updateAgendaBadges();
      if (openExpand?.mode === "polls") fillExpandContent(openExpand.itemId, "polls");
    } catch (error) {
      console.warn(error);
    }
  }

  async function refreshResults() {
    try {
      renderResultsSection(await fetchResults());
    } catch (error) {
      console.warn(error);
    }
  }

  async function refreshLive() {
    try {
      const state = await fetchLiveState();
      if (!state) return;
      agendaItems = state.agenda || [];
      const signature = agendaSignature(agendaItems);
      if (signature !== lastAgendaSignature) {
        lastAgendaSignature = signature;
        renderLiveProgram(agendaItems);
        restoreOpenExpandAfterRerender();
        updateAgendaBadges();
      }
      await refreshQuestions();
      await refreshPolls();
      await refreshResults();
    } catch (error) {
      console.warn(error);
    }
  }

  refreshLive();
  window.setInterval(refreshLive, 10000);
  subscribeLiveRealtime(() => refreshLive());

  document.getElementById("liveProgramList")?.addEventListener("click", (event) => {
    const actionBtn = event.target.closest("[data-agenda-action]");
    if (actionBtn) {
      openAgendaExpand(actionBtn.dataset.agendaId, actionBtn.dataset.agendaAction);
      return;
    }

    const filterBtn = event.target.closest('[data-role="question-filter"]');
    if (filterBtn) {
      filterBtn.parentElement.querySelectorAll("button").forEach((btn) => btn.classList.remove("is-active"));
      filterBtn.classList.add("is-active");
      activeQuestionFilter = filterBtn.dataset.filter;
      if (openExpand) {
        const listBox = filterBtn.closest(".live-audience-questions")?.querySelector('[data-role="question-list"]');
        renderQuestionListInto(listBox, openExpand.itemId, activeQuestionFilter);
      }
      return;
    }

    const submitBtn = event.target.closest('[data-role="question-submit"]');
    if (submitBtn && openExpand) {
      const form = submitBtn.closest(".live-question-form");
      const textarea = form?.querySelector('[data-role="question-input"]');
      const body = textarea?.value.trim() || "";
      if (!body) {
        showToast("Ierakstiet jautājumu pirms iesniegšanas.");
        return;
      }
      const isAnonymous = form.querySelector('[data-role="question-anon"]')?.checked !== false;
      submitBtn.disabled = true;
      submitQuestion(body, openExpand.itemId, isAnonymous)
        .then((data) => {
          if (data?.question?.id) rememberMyQuestion(data.question.id);
          textarea.value = "";
          const counter = form.querySelector('[data-role="question-count"]');
          if (counter) counter.textContent = "280 rakstzīmes";
          showToast("Jautājums iesniegts moderācijai.");
        })
        .catch((error) => showToast(error.message || "Jautājumu neizdevās iesniegt."))
        .finally(() => { submitBtn.disabled = false; });
    }
  });

  document.getElementById("liveProgramList")?.addEventListener("input", (event) => {
    const input = event.target.closest('[data-role="question-input"]');
    if (!input) return;
    const counter = input.closest(".live-question-form")?.querySelector('[data-role="question-count"]');
    if (counter) counter.textContent = `${280 - input.value.length} rakstzīmes`;
  });

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-question-vote]");
    if (!button) return;
    button.disabled = true;
    voteQuestion(button.dataset.questionVote)
      .then(() => {
        button.classList.add("is-voted");
        refreshQuestions();
      })
      .catch((error) => {
        showToast(error.message || "Balsojumu neizdevās iesniegt.");
        button.disabled = false;
      });
  });

  document.addEventListener("click", (event) => {
    const option = event.target.closest("[data-poll-id][data-option-id]");
    if (!option) return;
    const card = option.closest(".agenda-poll-card");
    if (option.dataset.multi === "true") {
      option.classList.toggle("is-selected");
    } else {
      card?.querySelectorAll("[data-poll-id][data-option-id]").forEach((item) => item.classList.remove("is-selected"));
      option.classList.add("is-selected");
    }
    const submit = card?.querySelector('[data-role="poll-option-submit"]');
    if (submit) submit.disabled = !card?.querySelector(".poll-option.is-selected");
  });

  document.addEventListener("click", (event) => {
    const submit = event.target.closest('[data-role="poll-option-submit"]');
    if (!submit) return;
    const card = submit.closest(".agenda-poll-card");
    const selected = [...(card?.querySelectorAll(".poll-option.is-selected") || [])];
    if (!selected.length) return;
    const pollId = selected[0].dataset.pollId;
    const optionIds = selected.map((item) => item.dataset.optionId);
    submit.disabled = true;
    submitPollVote(pollId, optionIds.length > 1 ? { optionIds } : { optionId: optionIds[0] })
      .then(() => {
        showToast("Balsojums iesniegts.");
        refreshPolls();
        if (openExpand?.mode === "polls") fillExpandContent(openExpand.itemId, "polls");
      })
      .catch((error) => {
        showToast(error.message || "Balsojumu neizdevās iesniegt.");
        submit.disabled = false;
      });
  });

  document.addEventListener("click", (event) => {
    const submit = event.target.closest('[data-role="poll-text-submit"]');
    if (!submit) return;
    const card = submit.closest(".agenda-poll-card");
    const textarea = card?.querySelector(".poll-text-input");
    const text = textarea?.value.trim() || "";
    if (!text) {
      showToast("Ierakstiet atbildi pirms iesniegšanas.");
      return;
    }
    submit.disabled = true;
    submitPollVote(submit.dataset.pollId, { responseText: text })
      .then(() => {
        textarea.value = "";
        showToast("Atbilde iesniegta.");
        refreshPolls();
        if (openExpand?.mode === "polls") fillExpandContent(openExpand.itemId, "polls");
      })
      .catch((error) => showToast(error.message || "Atbildi neizdevās iesniegt."))
      .finally(() => { submit.disabled = false; });
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
    document.querySelectorAll(".live-pass-link, [data-pass-link]").forEach((link) => {
      link.href = `../pass/?token=${encodeURIComponent(networkingToken)}`;
    });
    initNetworkingPass(networkingToken);
  }

  const availableViews = ["program", "results", "networking"];
  const requestedView = params.get("view");
  setActiveTab(availableViews.includes(requestedView) ? requestedView : "program");
}

function initResults() {
  fetchResults()
    .then((data) => renderResultsSection(data))
    .catch((error) => {
      const pollList = document.getElementById("resultsPollList");
      if (pollList) pollList.innerHTML = `<article class="results-empty"><span>Rezultāti</span><h2>Rezultātus neizdevās ielādēt.</h2><p class="fine">${error.message}</p></article>`;
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
  if (page === "checkin") initCheckin();
  if (page === "results") initResults();
  if (page === "archive") initArchive();
});
