(function () {
  if (document.body.dataset.page !== "admin") return;

  const IDLE_LIMIT_MS = 30 * 60 * 1000;
  const PRESENTATION_MODES = [
    { id: "waiting", label: "Gaidīšanas ekrāns" },
    { id: "agenda", label: "Programmas punkts" },
    { id: "poll_question", label: "Balsojuma jautājums" },
    { id: "poll_results", label: "Balsojuma rezultāti" },
    { id: "questions", label: "Auditorijas jautājumi" },
    { id: "announcement", label: "Informatīvs paziņojums" },
    { id: "results", label: "Kopējie rezultāti" },
    { id: "closing", label: "Noslēguma ekrāns" },
  ];
  const POLL_TYPES = [
    { id: "single_choice", label: "Vienas atbildes izvēle" },
    { id: "multiple_choice", label: "Vairāku atbilžu izvēle" },
    { id: "scale", label: "Vērtējuma skala" },
    { id: "yes_no", label: "Jā / Nē" },
    { id: "open_text", label: "Atvērtā atbilde" },
    { id: "word_cloud", label: "Vārdu mākonis" },
  ];

  const supabaseClient = (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  let currentActor = null;
  let lastActivity = Date.now();
  let agendaItems = [];
  let dashboardPolls = [];
  let presentationState = null;
  let moderationStatus = "pending";
  let pollsFilter = "all";
  let wizardStep = 1;
  let wizardOptions = ["", ""];

  function el(id) { return document.getElementById(id); }

  async function getAccessToken() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token || null;
  }

  async function adminFetch(path, options = {}) {
    const token = await getAccessToken();
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Pieprasījumu neizdevās izpildīt.");
    return data;
  }

  function fmtTime(iso) {
    if (!iso) return "--:--";
    return new Intl.DateTimeFormat("lv-LV", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(new Date(iso));
  }

  // ---------------------------------------------------------------- auth --

  function showLogin() {
    el("adminLoginScreen").hidden = false;
    el("adminApp").hidden = true;
  }

  function showApp() {
    el("adminLoginScreen").hidden = true;
    el("adminApp").hidden = false;
  }

  async function handleLogin(event) {
    event.preventDefault();
    const email = el("loginEmail").value.trim();
    const password = el("loginPassword").value;
    const submit = el("adminLoginSubmit");
    submit.disabled = true;
    setText("adminLoginStatus", "Pieslēdzas...");
    try {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await boot();
    } catch (error) {
      setText("adminLoginStatus", error.message === "Invalid login credentials"
        ? "Nepareizs e-pasts vai parole."
        : (error.message || "Pieslēgties neizdevās."));
    } finally {
      submit.disabled = false;
    }
  }

  async function handleForgotPassword() {
    const email = el("loginEmail").value.trim();
    if (!email) {
      setText("adminLoginStatus", "Ieraksti e-pastu, lai atjaunotu paroli.");
      return;
    }
    try {
      await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
      setText("adminLoginStatus", "Paroles atjaunošanas saite nosūtīta uz e-pastu.");
    } catch (error) {
      setText("adminLoginStatus", error.message || "Neizdevās nosūtīt saiti.");
    }
  }

  async function handleLogout() {
    await supabaseClient?.auth.signOut();
    window.location.reload();
  }

  function trackActivity() {
    ["click", "keydown", "mousemove", "touchstart"].forEach((evt) => {
      document.addEventListener(evt, () => { lastActivity = Date.now(); }, { passive: true });
    });
    window.setInterval(() => {
      if (Date.now() - lastActivity > IDLE_LIMIT_MS) handleLogout();
    }, 60000);
  }

  function applyRoleVisibility() {
    const isSuperadmin = currentActor?.role === "superadmin";
    el("adminOpenUsers").hidden = !isSuperadmin;
    const canWrite = ["superadmin", "organizer"].includes(currentActor?.role);
    const canModerate = ["superadmin", "organizer", "moderator"].includes(currentActor?.role);
    document.querySelectorAll("[data-requires-write]").forEach((node) => { node.hidden = !canWrite; });
    document.querySelectorAll("[data-requires-moderate]").forEach((node) => { node.hidden = !canModerate; });
  }

  // ---------------------------------------------------------------- nav --

  const PANEL_LABELS = {
    dashboard: "Vadības pults",
    moderation: "Moderācija",
    polls: "Balsojumi",
    participants: "Dalībnieki",
  };

  function setActivePanel(name) {
    document.querySelectorAll("[data-admin-nav]").forEach((btn) => btn.classList.toggle("is-active", btn.dataset.adminNav === name));
    document.querySelectorAll("[data-admin-panel]").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.adminPanel === name));
    setText("adminBreadcrumbSection", PANEL_LABELS[name] || name);
    if (name === "moderation") refreshModeration();
    if (name === "polls") refreshPollsPanel();
    if (name === "participants") refreshParticipants();
  }

  function openModal(id) { el(id).hidden = false; }
  function closeModal(id) { el(id).hidden = true; }

  // ----------------------------------------------------------- dashboard --

  function currentAgendaItem() {
    return agendaItems.find((item) => item.status === "now") || null;
  }

  function nextAgendaItem() {
    const next = agendaItems.find((item) => item.status === "next");
    if (next) return next;
    const current = currentAgendaItem();
    if (!current) return agendaItems.find((item) => !item.is_break && item.status !== "done" && item.status !== "cancelled") || null;
    const ordered = agendaItems.filter((item) => !item.is_break && item.status !== "cancelled");
    const index = ordered.findIndex((item) => item.id === current.id);
    return ordered[index + 1] || null;
  }

  function renderDashboardAgenda() {
    const current = currentAgendaItem();
    if (!current) {
      setText("dashAgendaTitle", "Nav aktīva programmas punkta");
      setText("dashAgendaSpeaker", "");
      setText("dashAgendaCategory", "—");
      el("dashAgendaProgress").style.width = "0%";
      setText("dashAgendaStart", "--:--");
      setText("dashAgendaEnd", "--:--");
      setText("dashAgendaRemaining", "—");
      return;
    }
    setText("dashAgendaCategory", current.category || (current.is_break ? "Pauze" : "Programma"));
    setText("dashAgendaTitle", current.title);
    setText("dashAgendaSpeaker", [current.speaker_name, current.speaker_company].filter(Boolean).join(" · "));
    const start = new Date(current.starts_at).getTime();
    const end = new Date(current.ends_at).getTime();
    const now = Date.now();
    const percent = end > start ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : 0;
    el("dashAgendaProgress").style.width = `${percent}%`;
    setText("dashAgendaStart", fmtTime(current.starts_at));
    setText("dashAgendaEnd", fmtTime(current.ends_at));
    const remainingMin = Math.max(0, Math.round((end - now) / 60000));
    setText("dashAgendaRemaining", now > end ? "Laiks beidzies" : `${remainingMin} min atlikušas`);
  }

  async function renderDashboardPoll() {
    try {
      const publicState = await (await fetch(`${API_BASE}/polls`)).json();
      const active = publicState.active;
      if (!active) {
        setText("dashPollTitle", "Nav aktīva balsojuma");
        setText("dashPollCount", "0 atbildes");
        el("dashPollMeter").innerHTML = "";
        return;
      }
      setText("dashPollTitle", active.poll.title);
      setText("dashPollCount", `${active.total_votes || 0} atbildes`);
      el("dashPollMeter").innerHTML = (active.options || []).map((option) => `
        <div class="admin-mini-meter-row">
          <span>${option.label}</span>
          <span class="admin-mini-meter-track"><span style="width:${option.percent || 0}%"></span></span>
          <strong>${option.percent || 0}%</strong>
        </div>
      `).join("") || `<p class="live-empty">Šis balsojums neizmanto opcijas.</p>`;
    } catch {
      // keep last rendered state on transient errors
    }
  }

  function questionPreviewCard(question) {
    return `
      <article class="admin-question-preview">
        <span class="admin-vote-badge">▲ ${question.vote_count || 0}</span>
        <p>${question.body}</p>
        <button type="button" class="admin-link" data-approve-question="${question.id}">Apstiprināt</button>
      </article>
    `;
  }

  async function refreshDashboard() {
    try {
      const [liveData, questionsData, statsData] = await Promise.all([
        adminFetch("/admin-live"),
        adminFetch("/admin-questions?status=pending"),
        adminFetch("/admin-registrations?action=stats"),
      ]);
      agendaItems = liveData.agenda || [];
      renderDashboardAgenda();
      await renderDashboardPoll();

      const pending = questionsData.questions || [];
      el("dashPendingQuestions").innerHTML = pending.length
        ? pending.slice(0, 3).map(questionPreviewCard).join("")
        : `<p class="live-empty">Nav jautājumu, kas gaida moderāciju.</p>`;
      const badge = el("adminPendingBadge");
      badge.hidden = !pending.length;
      badge.textContent = String(pending.length);
      setText("tabCountPending", String(pending.length));

      setText("dashArrivedCount", `${statsData.arrived || 0}/${statsData.participants || 0}`);
      setText("dashQuestionCount", String(questionsData.questions?.length ?? "--"));

      const current = currentAgendaItem();
      setText("dashEventState", current ? "Pasākums notiek" : "Pasākums nav sācies");
      setText("adminEventStatus", current ? "Pasākums live" : "Gaida sākumu");
      setText("dashOnlineCount", `${statsData.arrived || 0} dalībnieki tiešsaistē`);
      setText("dashSyncTime", `Sinhronizēts ${new Intl.DateTimeFormat("lv-LV", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`);
    } catch (error) {
      console.warn(error);
    }
  }

  async function refreshAnswerCount() {
    try {
      const pollsData = await adminFetch("/admin-polls");
      dashboardPolls = pollsData.polls || [];
      const total = dashboardPolls.reduce((sum, poll) => sum + Number(poll.response_count || 0), 0);
      setText("dashAnswerCount", String(total));
    } catch (error) {
      console.warn(error);
    }
  }

  el("dashOpenProgram")?.addEventListener("click", () => { openModal("programModal"); renderProgramEditorList(); });
  el("dashNextAgenda")?.addEventListener("click", async () => {
    const next = nextAgendaItem();
    if (!next) { showToast("Nav nākamā programmas punkta."); return; }
    try {
      await adminFetch(`/admin-live?action=set-current&agenda_item_id=${next.id}`, { method: "POST" });
      showToast("Programma pārslēgta.");
      await refreshDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });
  el("dashExtend")?.addEventListener("click", async () => {
    const current = currentAgendaItem();
    if (!current) return;
    const newEnd = new Date(new Date(current.ends_at).getTime() + 5 * 60000).toISOString();
    try {
      await saveAgendaItem({ ...agendaItemToFormPayload(current), id: current.id, endsAt: newEnd });
      showToast("Pievienotas 5 minūtes.");
      await refreshDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });
  async function fetchActivePoll() {
    try {
      const data = await (await fetch(`${API_BASE}/polls`)).json();
      return data.active?.poll || null;
    } catch {
      return null;
    }
  }

  el("dashPollPresent")?.addEventListener("click", async () => {
    const active = await fetchActivePoll();
    if (!active) { showToast("Nav aktīva balsojuma."); return; }
    await setPresentationState({ mode: "poll_results", pollId: active.id });
    showToast("Rādīts prezentācijas ekrānā.");
  });
  el("dashPollClose")?.addEventListener("click", async () => {
    const active = await fetchActivePoll();
    if (!active) { showToast("Nav aktīva balsojuma."); return; }
    await adminFetch(`/admin-polls?action=close&poll_id=${active.id}`, { method: "POST" });
    showToast("Balsojums noslēgts.");
    await refreshDashboard();
    await refreshAnswerCount();
  });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-approve-question]");
    if (!button) return;
    try {
      await adminFetch(`/admin-questions?question_id=${button.dataset.approveQuestion}&action=status&status=approved`, { method: "POST" });
      showToast("Jautājums publicēts.");
      await refreshDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });

  // ------------------------------------------------------- presentation --

  function renderPresentationModeButtons() {
    el("presentModeButtons").innerHTML = PRESENTATION_MODES.map((mode) => `
      <button type="button" class="admin-mode-btn" data-present-mode="${mode.id}">${mode.label}</button>
    `).join("");
  }

  function highlightActiveMode() {
    document.querySelectorAll("[data-present-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.presentMode === presentationState?.state?.mode);
    });
  }

  async function refreshPresentationState() {
    try {
      presentationState = await (await fetch(`${API_BASE}/presentation`)).json();
      highlightActiveMode();
      el("presentResultsVisible").checked = Boolean(presentationState.state?.results_visible);
      el("presentQrVisible").checked = presentationState.state?.qr_visible !== false;
    } catch (error) {
      console.warn(error);
    }
  }

  async function setPresentationState(payload) {
    try {
      await adminFetch("/presentation", { method: "POST", body: JSON.stringify(payload) });
      await refreshPresentationState();
    } catch (error) {
      showToast(error.message || "Prezentācijas skatu neizdevās atjaunināt.");
    }
  }

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-present-mode]");
    if (!button) return;
    const mode = button.dataset.presentMode;
    const payload = { mode };
    if (mode === "agenda") payload.agendaItemId = currentAgendaItem()?.id || null;
    if (mode === "poll_question" || mode === "poll_results") {
      payload.pollId = (await fetchActivePoll())?.id || null;
    }
    setPresentationState(payload);
  });

  el("presentResultsVisible")?.addEventListener("change", (event) => setPresentationState({ resultsVisible: event.target.checked }));
  el("presentQrVisible")?.addEventListener("change", (event) => setPresentationState({ qrVisible: event.target.checked }));
  el("presentSendAnnouncement")?.addEventListener("click", () => {
    const text = el("presentAnnouncementText").value.trim();
    if (!text) { showToast("Ieraksti ziņu pirms nosūtīšanas."); return; }
    setPresentationState({ mode: "announcement", announcementText: text });
    showToast("Paziņojums nosūtīts uz ekrānu.");
  });

  function cycleMode(direction) {
    const order = PRESENTATION_MODES.map((mode) => mode.id);
    const current = presentationState?.state?.mode || "waiting";
    const index = order.indexOf(current);
    const next = order[(index + direction + order.length) % order.length];
    setPresentationState({ mode: next });
  }

  document.addEventListener("keydown", (event) => {
    const tag = (event.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (document.querySelector(".admin-panel.is-active")?.dataset.adminPanel !== "dashboard") return;
    if (event.key === "ArrowRight") cycleMode(1);
    else if (event.key === "ArrowLeft") cycleMode(-1);
    else if (event.key.toLowerCase() === "r") setPresentationState({ resultsVisible: !presentationState?.state?.results_visible });
    else if (event.key.toLowerCase() === "q") setPresentationState({ mode: "questions" });
    else if (event.key.toLowerCase() === "w") setPresentationState({ mode: "waiting" });
  });

  // ------------------------------------------------------------ program --

  function agendaItemToFormPayload(item) {
    return {
      title: item.title,
      category: item.category || "",
      startsAt: item.starts_at,
      endsAt: item.ends_at,
      speakerName: item.speaker_name || "",
      speakerRole: item.speaker_role || "",
      speakerCompany: item.speaker_company || "",
      speakerImageUrl: item.speaker_image_url || "",
      description: item.description || "",
      materialsUrl: item.materials_url || "",
      videoUrl: item.video_url || "",
      isBreak: Boolean(item.is_break),
      questionsEnabled: item.questions_enabled !== false,
      displayOrder: item.display_order || 0,
    };
  }

  function toLocalInputValue(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function renderProgramEditorList() {
    const container = el("programEditorList");
    if (!agendaItems.length) { container.innerHTML = `<p class="live-empty">Vēl nav programmas punktu.</p>`; return; }
    container.innerHTML = agendaItems.map((item) => `
      <article class="admin-program-row" draggable="true" data-drag-id="${item.id}">
        <span class="admin-drag-handle" aria-hidden="true">⠿</span>
        <span class="admin-program-time">${fmtTime(item.starts_at)}</span>
        <div class="admin-program-row-body">
          <span class="admin-chip">${item.category || (item.is_break ? "Pauze" : "Programma")}</span>
          <strong>${item.title}</strong>
          <span class="admin-fine">${[item.speaker_name, item.speaker_company].filter(Boolean).join(" · ")}</span>
        </div>
        <span class="admin-status-pill admin-status-${item.status}">${item.status}</span>
        <span class="admin-fine">${item.question_count || 0} jaut. · ${item.poll_count || 0} balsoj.</span>
        <div class="admin-program-row-actions">
          <button type="button" class="admin-link" data-edit-agenda="${item.id}">Rediģēt</button>
          <button type="button" class="admin-link" data-duplicate-agenda="${item.id}">Dublēt</button>
          <button type="button" class="admin-link is-destructive" data-cancel-agenda="${item.id}">Atcelt</button>
        </div>
      </article>
    `).join("");
  }

  function fillProgramForm(item) {
    el("agendaId").value = item?.id || "";
    el("agendaTitle").value = item?.title || "";
    el("agendaCategory").value = item?.category || "";
    el("agendaStarts").value = toLocalInputValue(item?.starts_at);
    el("agendaEnds").value = toLocalInputValue(item?.ends_at);
    el("agendaSpeaker").value = item?.speaker_name || "";
    el("agendaSpeakerRole").value = item?.speaker_role || "";
    el("agendaSpeakerCompany").value = item?.speaker_company || "";
    el("agendaSpeakerImageUrl").value = item?.speaker_image_url || "";
    el("agendaDescription").value = item?.description || "";
    el("agendaMaterialsUrl").value = item?.materials_url || "";
    el("agendaVideoUrl").value = item?.video_url || "";
    el("agendaIsBreak").checked = Boolean(item?.is_break);
    el("agendaQuestionsEnabled").checked = item?.questions_enabled !== false;
  }

  async function saveAgendaItem(payload) {
    await adminFetch("/admin-live?action=upsert-agenda", { method: "POST", body: JSON.stringify(payload) });
    const liveData = await adminFetch("/admin-live");
    agendaItems = liveData.agenda || [];
    renderProgramEditorList();
  }

  el("programItemForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {
      id: el("agendaId").value || undefined,
      title: el("agendaTitle").value,
      category: el("agendaCategory").value,
      startsAt: new Date(el("agendaStarts").value).toISOString(),
      endsAt: new Date(el("agendaEnds").value).toISOString(),
      speakerName: el("agendaSpeaker").value,
      speakerRole: el("agendaSpeakerRole").value,
      speakerCompany: el("agendaSpeakerCompany").value,
      speakerImageUrl: el("agendaSpeakerImageUrl").value,
      description: el("agendaDescription").value,
      materialsUrl: el("agendaMaterialsUrl").value,
      videoUrl: el("agendaVideoUrl").value,
      isBreak: el("agendaIsBreak").checked,
      questionsEnabled: el("agendaQuestionsEnabled").checked,
    };
    try {
      await saveAgendaItem(payload);
      showToast("Programmas punkts saglabāts.");
      fillProgramForm(null);
    } catch (error) {
      showToast(error.message);
    }
  });

  el("programFormReset")?.addEventListener("click", () => fillProgramForm(null));

  document.addEventListener("click", async (event) => {
    const editBtn = event.target.closest("[data-edit-agenda]");
    if (editBtn) {
      fillProgramForm(agendaItems.find((item) => item.id === editBtn.dataset.editAgenda));
      return;
    }
    const dupBtn = event.target.closest("[data-duplicate-agenda]");
    if (dupBtn) {
      try {
        await adminFetch(`/admin-live?action=duplicate&agenda_item_id=${dupBtn.dataset.duplicateAgenda}`, { method: "POST" });
        const liveData = await adminFetch("/admin-live");
        agendaItems = liveData.agenda || [];
        renderProgramEditorList();
        showToast("Programmas punkts dublēts.");
      } catch (error) {
        showToast(error.message);
      }
      return;
    }
    const cancelBtn = event.target.closest("[data-cancel-agenda]");
    if (cancelBtn) {
      if (!window.confirm("Atcelt šo programmas punktu?")) return;
      try {
        await adminFetch(`/admin-live?action=cancel&agenda_item_id=${cancelBtn.dataset.cancelAgenda}`, { method: "POST" });
        const liveData = await adminFetch("/admin-live");
        agendaItems = liveData.agenda || [];
        renderProgramEditorList();
        showToast("Programmas punkts atcelts.");
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  // Drag & drop reorder
  let dragSourceId = null;
  el("programEditorList")?.addEventListener("dragstart", (event) => {
    const row = event.target.closest("[data-drag-id]");
    if (!row) return;
    dragSourceId = row.dataset.dragId;
    event.dataTransfer.effectAllowed = "move";
  });
  el("programEditorList")?.addEventListener("dragover", (event) => {
    event.preventDefault();
    const row = event.target.closest("[data-drag-id]");
    if (!row || row.dataset.dragId === dragSourceId) return;
    const rect = row.getBoundingClientRect();
    const before = (event.clientY - rect.top) < rect.height / 2;
    row.parentElement.insertBefore(
      document.querySelector(`[data-drag-id="${dragSourceId}"]`),
      before ? row : row.nextSibling,
    );
  });
  el("programEditorList")?.addEventListener("dragend", async () => {
    const order = [...document.querySelectorAll("[data-drag-id]")].map((row) => row.dataset.dragId);
    try {
      await adminFetch("/admin-live?action=reorder", { method: "POST", body: JSON.stringify({ order }) });
      const liveData = await adminFetch("/admin-live");
      agendaItems = liveData.agenda || [];
      renderProgramEditorList();
    } catch (error) {
      showToast(error.message);
    }
  });

  // --------------------------------------------------------- moderation --

  el("moderationTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-status]");
    if (!button) return;
    document.querySelectorAll("#moderationTabs button").forEach((btn) => btn.classList.remove("is-active"));
    button.classList.add("is-active");
    moderationStatus = button.dataset.status;
    refreshModeration();
  });
  el("moderationSearch")?.addEventListener("input", debounce(refreshModeration, 300));
  el("moderationAgendaFilter")?.addEventListener("change", refreshModeration);

  function debounce(fn, wait) {
    let timer = null;
    return (...args) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn(...args), wait);
    };
  }

  function questionRowMarkup(question) {
    const author = question.is_anonymous ? "Anonīms" : `${question.participants?.first_name || ""} ${question.participants?.last_name || ""}`.trim() || "Dalībnieks";
    return `
      <article class="admin-question-row" data-question-id="${question.id}">
        <span class="admin-vote-badge">▲ ${question.vote_count || 0}</span>
        <div class="admin-question-row-body">
          <span class="admin-fine">${author} · ${new Date(question.created_at).toLocaleTimeString("lv-LV")}</span>
          <p>${question.body}</p>
        </div>
        <div class="admin-question-row-actions">
          <button type="button" class="btn secondary" data-question-action="approved">Apstiprināt</button>
          <button type="button" class="btn secondary" data-question-action="rejected">Paslēpt</button>
          <div class="admin-more-menu">
            <button type="button" class="admin-more-toggle">⋯</button>
            <div class="admin-more-dropdown" hidden>
              <button type="button" data-question-action="highlighted">Izcelt</button>
              <button type="button" data-question-action="answered">Atzīmēt kā atbildētu</button>
              <button type="button" data-question-action="archived">Arhivēt</button>
              <button type="button" data-question-present="${question.id}">Rādīt uz ekrāna</button>
              <button type="button" data-question-edit="${question.id}">Rediģēt tekstu</button>
              <button type="button" data-question-delete="${question.id}">Dzēst</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  async function refreshModeration() {
    const container = el("moderationList");
    const params = new URLSearchParams({ status: moderationStatus });
    const search = el("moderationSearch")?.value.trim();
    const agendaFilter = el("moderationAgendaFilter")?.value;
    if (search) params.set("search", search);
    if (agendaFilter && agendaFilter !== "all") params.set("agenda_item_id", agendaFilter);
    try {
      const data = await adminFetch(`/admin-questions?${params.toString()}`);
      const questions = data.questions || [];
      container.innerHTML = questions.length ? questions.map(questionRowMarkup).join("") : `<p class="live-empty">Nav jautājumu šajā skatā.</p>`;
      const topQuestion = [...questions].sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0))[0];
      el("moderationPreview").innerHTML = topQuestion
        ? `<span class="live-kicker">Populārākais jautājums</span><h3>"${topQuestion.body}"</h3><p class="admin-fine">▲ ${topQuestion.vote_count || 0}</p><button type="button" class="live-submit" data-question-present="${topQuestion.id}">Parādīt uz lielā ekrāna <span>→</span></button>`
        : `<p class="live-empty">Nav izcelta jautājuma.</p>`;
      populateAgendaFilterOptions();
    } catch (error) {
      container.innerHTML = `<p class="live-empty">${error.message}</p>`;
    }
  }

  function populateAgendaFilterOptions() {
    const select = el("moderationAgendaFilter");
    if (!select || select.dataset.populated === "true") return;
    agendaItems.filter((item) => !item.is_break).forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.title;
      select.appendChild(option);
    });
    select.dataset.populated = "true";
  }

  document.addEventListener("click", async (event) => {
    const moreToggle = event.target.closest(".admin-more-toggle");
    if (moreToggle) {
      const dropdown = moreToggle.nextElementSibling;
      document.querySelectorAll(".admin-more-dropdown").forEach((node) => { if (node !== dropdown) node.hidden = true; });
      dropdown.hidden = !dropdown.hidden;
      return;
    }

    const actionBtn = event.target.closest("[data-question-action]");
    if (actionBtn) {
      const row = actionBtn.closest("[data-question-id]");
      try {
        await adminFetch(`/admin-questions?question_id=${row.dataset.questionId}&action=status&status=${actionBtn.dataset.questionAction}`, { method: "POST" });
        showToast("Jautājuma statuss atjaunināts.");
        await refreshModeration();
        await refreshDashboard();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const presentBtn = event.target.closest("[data-question-present]");
    if (presentBtn) {
      await setPresentationState({ mode: "questions", questionId: presentBtn.dataset.questionPresent });
      await adminFetch(`/admin-questions?question_id=${presentBtn.dataset.questionPresent}&action=status&status=shown_on_screen`, { method: "POST" }).catch(() => null);
      showToast("Jautājums parādīts uz ekrāna.");
      await refreshModeration();
      return;
    }

    const editBtn = event.target.closest("[data-question-edit]");
    if (editBtn) {
      const row = editBtn.closest("[data-question-id]") || document.querySelector(`[data-question-id="${editBtn.dataset.questionEdit}"]`);
      const currentText = row?.querySelector("p")?.textContent || "";
      const updated = window.prompt("Labot jautājuma tekstu (oriģināls tiek saglabāts audita žurnālā):", currentText);
      if (updated === null || !updated.trim()) return;
      try {
        await adminFetch(`/admin-questions?question_id=${editBtn.dataset.questionEdit}&action=edit`, {
          method: "POST",
          body: JSON.stringify({ body: updated.trim() }),
        });
        showToast("Jautājums rediģēts.");
        await refreshModeration();
      } catch (error) {
        showToast(error.message);
      }
      return;
    }

    const deleteBtn = event.target.closest("[data-question-delete]");
    if (deleteBtn) {
      if (!window.confirm("Dzēst šo jautājumu? Šo darbību nevar atsaukt.")) return;
      try {
        await adminFetch(`/admin-questions?question_id=${deleteBtn.dataset.questionDelete}&action=delete`, { method: "POST" });
        showToast("Jautājums dzēsts.");
        await refreshModeration();
        await refreshDashboard();
      } catch (error) {
        showToast(error.message);
      }
    }
  });

  // -------------------------------------------------------------- polls --

  el("pollsTabs")?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    document.querySelectorAll("#pollsTabs button").forEach((btn) => btn.classList.remove("is-active"));
    button.classList.add("is-active");
    pollsFilter = button.dataset.filter;
    renderPollsList();
  });

  function pollTypeIcon() {
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 19V11M12 19V5M19 19v-6"/></svg>`;
  }

  function pollRowMarkup(poll) {
    const isActive = poll.status === "active";
    const statusLabel = { draft: "Melnraksts", ready: "Plānots", active: "Aktīvs", paused: "Apturēts", closed: "Pabeigts", archived: "Arhivēts" }[poll.status] || poll.status;
    const typeLabel = POLL_TYPES.find((type) => type.id === poll.poll_type)?.label || poll.poll_type;
    const actions = isActive
      ? `<button type="button" class="btn secondary" data-poll-present="${poll.id}">Prezentēt</button>
         <button type="button" class="live-submit is-pink" data-poll-close="${poll.id}">Noslēgt</button>`
      : `${["draft", "ready"].includes(poll.status) ? `<button type="button" class="btn secondary" data-poll-activate="${poll.id}">Aktivizēt</button>` : ""}
         <div class="admin-more-menu">
           <button type="button" class="admin-more-toggle">⋯</button>
           <div class="admin-more-dropdown" hidden>
             ${poll.status === "paused" ? `<button type="button" data-poll-reopen="${poll.id}">Atkārtoti atvērt</button>` : ""}
             ${poll.status === "active" ? `<button type="button" data-poll-pause="${poll.id}">Apturēt</button>` : ""}
             <button type="button" data-poll-clear="${poll.id}">Notīrīt atbildes</button>
             <button type="button" data-poll-archive="${poll.id}">Arhivēt</button>
             <button type="button" data-poll-export="${poll.id}">Eksportēt CSV</button>
           </div>
         </div>`;
    return `
      <article class="admin-poll-row ${isActive ? "is-active" : ""}">
        <span class="admin-poll-icon">${pollTypeIcon()}</span>
        <div class="admin-poll-row-body">
          <span class="admin-status-pill admin-status-${poll.status}">${statusLabel}</span>
          <strong>${poll.title}</strong>
          <span class="admin-fine">${typeLabel}</span>
        </div>
        <strong class="admin-poll-count">${poll.response_count || 0}<span>atbildes</span></strong>
        <div class="admin-poll-row-actions">${actions}</div>
      </article>
    `;
  }

  function renderPollsList() {
    const container = el("pollsList");
    const filtered = pollsFilter === "all" ? dashboardPolls : dashboardPolls.filter((poll) => (pollsFilter === "active" ? poll.status === "active" : poll.status === pollsFilter));
    container.innerHTML = filtered.length ? filtered.map(pollRowMarkup).join("") : `<p class="live-empty">Nav balsojumu šajā skatā.</p>`;
  }

  async function refreshPollsPanel() {
    await refreshAnswerCount();
    renderPollsList();
  }

  document.addEventListener("click", async (event) => {
    const activateBtn = event.target.closest("[data-poll-activate]");
    if (activateBtn) {
      try {
        await adminFetch(`/admin-polls?action=activate&poll_id=${activateBtn.dataset.pollActivate}`, { method: "POST" });
        showToast("Balsojums aktivizēts.");
        await refreshPollsPanel();
      } catch (error) { showToast(error.message); }
      return;
    }
    const closeBtn = event.target.closest("[data-poll-close]");
    if (closeBtn) {
      await adminFetch(`/admin-polls?action=close&poll_id=${closeBtn.dataset.pollClose}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshPollsPanel();
      return;
    }
    const pauseBtn = event.target.closest("[data-poll-pause]");
    if (pauseBtn) {
      await adminFetch(`/admin-polls?action=pause&poll_id=${pauseBtn.dataset.pollPause}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshPollsPanel();
      return;
    }
    const reopenBtn = event.target.closest("[data-poll-reopen]");
    if (reopenBtn) {
      await adminFetch(`/admin-polls?action=reopen&poll_id=${reopenBtn.dataset.pollReopen}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshPollsPanel();
      return;
    }
    const archiveBtn = event.target.closest("[data-poll-archive]");
    if (archiveBtn) {
      if (!window.confirm("Arhivēt šo balsojumu?")) return;
      await adminFetch(`/admin-polls?action=archive&poll_id=${archiveBtn.dataset.pollArchive}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshPollsPanel();
      return;
    }
    const clearBtn = event.target.closest("[data-poll-clear]");
    if (clearBtn) {
      if (!window.confirm("Dzēst visas šī balsojuma atbildes? Šo darbību nevar atsaukt.")) return;
      await adminFetch(`/admin-polls?action=clear-responses&poll_id=${clearBtn.dataset.pollClear}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshPollsPanel();
      return;
    }
    const presentBtn = event.target.closest("[data-poll-present]");
    if (presentBtn) {
      await setPresentationState({ mode: "poll_question", pollId: presentBtn.dataset.pollPresent });
      showToast("Balsojums parādīts uz ekrāna.");
      return;
    }
    const exportBtn = event.target.closest("[data-poll-export]");
    if (exportBtn) {
      downloadCsv(`/admin-polls?action=export&poll_id=${exportBtn.dataset.pollExport}`, `poll-${exportBtn.dataset.pollExport}-results.csv`);
    }
  });

  // ---------------------------------------------------------- poll wizard --

  function renderPollTypeGrid() {
    el("pollTypeGrid").innerHTML = POLL_TYPES.map((type) => `
      <button type="button" class="admin-poll-type-option" data-wizard-type="${type.id}">${type.label}</button>
    `).join("");
  }

  let wizardType = "single_choice";

  el("pollsOpenWizard")?.addEventListener("click", () => {
    wizardStep = 1;
    wizardType = "single_choice";
    wizardOptions = ["", ""];
    el("wizardTitle").value = "";
    populateWizardAgendaSelect();
    renderPollTypeGrid();
    updateWizardStepView();
    openModal("pollWizardModal");
  });

  function populateWizardAgendaSelect() {
    const select = el("wizardAgendaItem");
    select.innerHTML = `<option value="">Nav piesaistīts</option>` + agendaItems.filter((item) => !item.is_break).map((item) => `<option value="${item.id}">${item.title}</option>`).join("");
  }

  document.addEventListener("click", (event) => {
    const typeBtn = event.target.closest("[data-wizard-type]");
    if (typeBtn && typeBtn.closest("#pollTypeGrid")) {
      wizardType = typeBtn.dataset.wizardType;
      document.querySelectorAll("[data-wizard-type]").forEach((btn) => btn.classList.toggle("is-active", btn === typeBtn));
      const isChoice = ["single_choice", "multiple_choice"].includes(wizardType);
      el("wizardOptionsBox").hidden = !isChoice;
      el("wizardScaleBox").hidden = wizardType !== "scale";
    }
  });

  function renderWizardOptions() {
    el("wizardOptionsList").innerHTML = wizardOptions.map((value, index) => `
      <div class="admin-wizard-option-row">
        <input type="text" value="${value.replace(/"/g, "&quot;")}" data-option-index="${index}" placeholder="Variants ${index + 1}">
        ${wizardOptions.length > 2 ? `<button type="button" class="admin-link" data-remove-option="${index}">✕</button>` : ""}
      </div>
    `).join("");
  }

  el("wizardAddOption")?.addEventListener("click", () => {
    if (wizardOptions.length >= 8) return;
    wizardOptions.push("");
    renderWizardOptions();
  });
  el("wizardOptionsList")?.addEventListener("input", (event) => {
    const input = event.target.closest("[data-option-index]");
    if (!input) return;
    wizardOptions[Number(input.dataset.optionIndex)] = input.value;
  });
  el("wizardOptionsList")?.addEventListener("click", (event) => {
    const removeBtn = event.target.closest("[data-remove-option]");
    if (!removeBtn) return;
    wizardOptions.splice(Number(removeBtn.dataset.removeOption), 1);
    renderWizardOptions();
  });

  function updateWizardStepView() {
    document.querySelectorAll(".admin-wizard-step").forEach((step) => step.classList.toggle("is-active", Number(step.dataset.wizardStep) === wizardStep));
    document.querySelectorAll(".admin-wizard-steps span").forEach((step) => step.classList.toggle("is-active", Number(step.dataset.step) === wizardStep));
    el("wizardBack").hidden = wizardStep === 1;
    el("wizardNext").hidden = wizardStep === 4;
    el("wizardSubmit").hidden = wizardStep !== 4;
    if (wizardStep === 2) renderWizardOptions();
    if (wizardStep === 4) renderWizardPreview();
  }

  function renderWizardPreview() {
    const typeLabel = POLL_TYPES.find((type) => type.id === wizardType)?.label || wizardType;
    el("wizardPreview").innerHTML = `
      <article class="agenda-poll-card">
        <span class="live-status-label"><i></i> Priekšskatījums</span>
        <h3>${el("wizardTitle").value || "Balsojuma jautājums"}</h3>
        <p class="admin-fine">${typeLabel}</p>
        ${["single_choice", "multiple_choice"].includes(wizardType)
          ? wizardOptions.filter(Boolean).map((option, index) => `<div class="poll-option"><span class="poll-letter">${String.fromCharCode(65 + index)}</span><strong>${option}</strong></div>`).join("")
          : ""}
      </article>
    `;
  }

  el("wizardNext")?.addEventListener("click", () => {
    if (wizardStep === 2 && !el("wizardTitle").value.trim()) { showToast("Ieraksti balsojuma jautājumu."); return; }
    wizardStep = Math.min(4, wizardStep + 1);
    updateWizardStepView();
  });
  el("wizardBack")?.addEventListener("click", () => {
    wizardStep = Math.max(1, wizardStep - 1);
    updateWizardStepView();
  });

  el("wizardSubmit")?.addEventListener("click", async () => {
    const settings = {
      anonymous: el("wizardAnonymous").checked,
      allowAnswerChange: el("wizardAllowChange").checked,
      resultsVisibleLive: el("wizardResultsLive").checked,
      showRespondentCount: el("wizardShowCount").checked,
      shuffleOptions: el("wizardShuffle").checked,
      resultsFormat: el("wizardResultsFormat").value,
      scaleMin: Number(el("wizardScaleMin").value) || 1,
      scaleMax: Number(el("wizardScaleMax").value) || 5,
    };
    const payload = {
      title: el("wizardTitle").value.trim(),
      agendaItemId: el("wizardAgendaItem").value || undefined,
      pollType: wizardType,
      options: wizardOptions.filter(Boolean),
      settings,
    };
    try {
      await adminFetch("/admin-polls?action=create", { method: "POST", body: JSON.stringify(payload) });
      showToast("Balsojums izveidots.");
      closeModal("pollWizardModal");
      await refreshPollsPanel();
    } catch (error) {
      showToast(error.message);
    }
  });

  // -------------------------------------------------------- participants --

  el("participantsStatusFilter")?.addEventListener("change", refreshParticipants);

  function participantRowMarkup(participant) {
    const initials = `${(participant.first_name || "?")[0]}${(participant.last_name || "?")[0]}`.toUpperCase();
    const maturity = participant.ai_maturity_level
      ? `MI: ${participant.ai_maturity_level}/10 · ${participant.ai_maturity_phase || ""} · ${participant.ai_maturity_anonymous ? "anonīmi" : "publiski"}${participant.ai_maturity_answered_at ? ` · ${new Date(participant.ai_maturity_answered_at).toLocaleDateString("lv-LV")}` : ""}`
      : "";
    return `
      <article class="admin-participant-row">
        <span class="admin-avatar-sm">${initials}</span>
        <div class="admin-participant-body">
          <strong>${participant.first_name} ${participant.last_name}</strong>
          <span class="admin-fine">${participant.role || ""}</span>
          ${maturity ? `<span class="admin-fine">${maturity}</span>` : ""}
        </div>
        <span class="admin-status-pill admin-status-${participant.status}">${participant.status}</span>
        <span class="admin-fine">${participant.access_mode}</span>
        <div class="admin-more-menu">
          <button type="button" class="admin-more-toggle">⋯</button>
          <div class="admin-more-dropdown" hidden>
            <button type="button" data-participant-approve="${participant.id}">Apstiprināt</button>
            <button type="button" data-participant-waitlist="${participant.id}">Gaidīšanas saraksts</button>
            <button type="button" data-participant-reject="${participant.id}">Noraidīt</button>
          </div>
        </div>
      </article>
    `;
  }

  async function refreshParticipants() {
    const container = el("participantsList");
    const status = el("participantsStatusFilter")?.value || "all";
    try {
      const data = await adminFetch(`/admin-registrations${status !== "all" ? `?status=${status}` : ""}`);
      const rows = data.registrations || [];
      container.innerHTML = rows.length ? rows.map(participantRowMarkup).join("") : `<p class="live-empty">Nav dalībnieku šajā skatā.</p>`;
      setText("participantsHeading", `${rows.length} reģistrēti dalībnieki`);
    } catch (error) {
      container.innerHTML = `<p class="live-empty">${error.message}</p>`;
    }
  }

  document.addEventListener("click", async (event) => {
    const approveBtn = event.target.closest("[data-participant-approve]");
    const waitlistBtn = event.target.closest("[data-participant-waitlist]");
    const rejectBtn = event.target.closest("[data-participant-reject]");
    if (approveBtn) {
      await adminFetch(`/admin-registrations?action=approve&participant_id=${approveBtn.dataset.participantApprove}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshParticipants();
    } else if (waitlistBtn) {
      await adminFetch(`/admin-registrations?action=waitlist&participant_id=${waitlistBtn.dataset.participantWaitlist}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshParticipants();
    } else if (rejectBtn) {
      await adminFetch(`/admin-registrations?action=reject&participant_id=${rejectBtn.dataset.participantReject}`, { method: "POST" }).catch((error) => showToast(error.message));
      await refreshParticipants();
    }
  });

  async function downloadCsv(path, filename) {
    const token = await getAccessToken();
    const response = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) { showToast("Eksportu neizdevās lejupielādēt."); return; }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  el("participantsExportCsv")?.addEventListener("click", (event) => {
    event.preventDefault();
    downloadCsv("/admin-registrations?action=export", "ai-reality-check-registrations.csv");
  });
  el("exportRegistrationsCsv")?.addEventListener("click", (event) => {
    event.preventDefault();
    downloadCsv("/admin-registrations?action=export", "ai-reality-check-registrations.csv");
  });
  el("exportQuestionsCsv")?.addEventListener("click", (event) => {
    event.preventDefault();
    downloadCsv("/admin-questions?action=export", "ai-reality-check-questions.csv");
  });

  // ----------------------------------------------------------------- users --

  el("adminOpenUsers")?.addEventListener("click", () => { openModal("usersModal"); refreshUsersList(); });
  el("adminOpenAudit")?.addEventListener("click", () => { openModal("auditModal"); refreshAuditLog(); });

  async function refreshUsersList() {
    try {
      const data = await adminFetch("/admin-users");
      el("usersList").innerHTML = (data.users || []).map((user) => `
        <article class="admin-user-row">
          <div>
            <strong>${user.display_name || user.email || "—"}</strong>
            <span class="admin-fine">${user.email || ""}</span>
          </div>
          <span class="admin-role-chip">${user.role}</span>
          <span class="admin-status-pill admin-status-${user.status}">${user.status}</span>
          <button type="button" class="admin-link" data-toggle-user-status="${user.user_id}" data-current-status="${user.status}">
            ${user.status === "active" ? "Atspējot" : "Aktivizēt"}
          </button>
        </article>
      `).join("") || `<p class="live-empty">Nav pievienotu lietotāju.</p>`;
    } catch (error) {
      el("usersList").innerHTML = `<p class="live-empty">${error.message}</p>`;
    }
  }

  el("inviteUserForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await adminFetch("/admin-users?action=invite", {
        method: "POST",
        body: JSON.stringify({
          email: el("inviteEmail").value,
          displayName: el("inviteDisplayName").value,
          role: el("inviteRole").value,
        }),
      });
      showToast("Uzaicinājums nosūtīts.");
      event.target.reset();
      await refreshUsersList();
    } catch (error) {
      showToast(error.message);
    }
  });

  document.addEventListener("click", async (event) => {
    const toggleBtn = event.target.closest("[data-toggle-user-status]");
    if (!toggleBtn) return;
    const nextStatus = toggleBtn.dataset.currentStatus === "active" ? "disabled" : "active";
    try {
      await adminFetch(`/admin-users?action=set-status&user_id=${toggleBtn.dataset.toggleUserStatus}`, {
        method: "POST",
        body: JSON.stringify({ status: nextStatus }),
      });
      await refreshUsersList();
    } catch (error) {
      showToast(error.message);
    }
  });

  async function refreshAuditLog() {
    try {
      const data = await adminFetch("/admin-registrations?action=audit-log");
      el("auditList").innerHTML = (data.logs || []).map((log) => `
        <article class="admin-audit-row">
          <span class="admin-fine">${new Date(log.created_at).toLocaleString("lv-LV")}</span>
          <strong>${log.action}</strong>
          <span class="admin-fine">${log.metadata?.actor_email || "—"}</span>
          <span class="admin-fine">${log.target_table || ""} ${log.target_id ? `#${log.target_id.slice(0, 8)}` : ""}</span>
        </article>
      `).join("") || `<p class="live-empty">Audita žurnāls ir tukšs.</p>`;
    } catch (error) {
      el("auditList").innerHTML = `<p class="live-empty">${error.message}</p>`;
    }
  }

  // -------------------------------------------------------------- modals --

  document.addEventListener("click", (event) => {
    const closeBtn = event.target.closest("[data-close-modal]");
    if (closeBtn) closeModal(closeBtn.dataset.closeModal);
  });
  document.querySelectorAll(".admin-modal").forEach((modal) => {
    modal.addEventListener("click", (event) => { if (event.target === modal) modal.hidden = true; });
  });

  el("adminAvatarButton")?.addEventListener("click", () => {
    el("adminAvatarDropdown").hidden = !el("adminAvatarDropdown").hidden;
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".admin-avatar-menu")) el("adminAvatarDropdown").hidden = true;
    if (!event.target.closest(".admin-more-menu")) document.querySelectorAll(".admin-more-dropdown").forEach((node) => { node.hidden = true; });
  });
  el("adminSignOut")?.addEventListener("click", handleLogout);

  // ------------------------------------------------------------------ boot --

  async function boot() {
    if (!supabaseClient) { showToast("Supabase nav konfigurēts."); return; }
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) { showLogin(); return; }

    try {
      currentActor = await adminFetch("/admin-users?action=whoami");
    } catch (error) {
      showToast("Šim kontam nav administratora tiesību.");
      await supabaseClient.auth.signOut();
      showLogin();
      return;
    }

    showApp();
    setText("adminActorEmail", currentActor.email);
    setText("adminActorRole", currentActor.role);
    setText("adminAvatarInitials", (currentActor.display_name || currentActor.email || "??").slice(0, 2).toUpperCase());
    applyRoleVisibility();
    trackActivity();
    renderPresentationModeButtons();
    setActivePanel("dashboard");

    await Promise.all([refreshDashboard(), refreshAnswerCount(), refreshPresentationState()]);

    subscribeLiveRealtime(() => {
      refreshDashboard();
      refreshPresentationState();
      if (document.querySelector(".admin-panel.is-active")?.dataset.adminPanel === "moderation") refreshModeration();
      if (document.querySelector(".admin-panel.is-active")?.dataset.adminPanel === "polls") refreshPollsPanel();
    });
    window.setInterval(() => {
      refreshDashboard();
      refreshPresentationState();
    }, 15000);
  }

  document.addEventListener("DOMContentLoaded", () => {
    el("adminLoginForm")?.addEventListener("submit", handleLogin);
    el("adminForgotPassword")?.addEventListener("click", handleForgotPassword);
    el("adminLogout")?.addEventListener("click", handleLogout);
    document.querySelectorAll("[data-admin-nav]").forEach((btn) => btn.addEventListener("click", () => setActivePanel(btn.dataset.adminNav)));
    boot();
  });
})();
