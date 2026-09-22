/* Layout adapters reuse existing controls/listeners. No new API or event state. */
(() => {
  if (document.body.dataset.page !== "admin") return;
  const $ = (selector) => document.querySelector(selector);
  const mobile = matchMedia("(max-width: 860px)");
  const button = (text, action, className = "btn secondary") => {
    const node = document.createElement("button");
    node.type = "button"; node.textContent = text; node.className = className;
    node.addEventListener("click", action);
    return node;
  };
  const dialog = (id, title) => {
    const node = document.createElement("dialog");
    node.id = id; node.className = "admin-mobile-dialog";
    const header = document.createElement("header");
    const heading = document.createElement("h2");
    heading.id = `${id}Title`; heading.textContent = title;
    node.setAttribute("aria-labelledby", heading.id);
    header.append(heading, button("Aizvērt", () => node.close()));
    node.append(header); document.body.append(node);
    return node;
  };
  const more = dialog("adminMobileMore", "Vairāk");
  const menu = document.createElement("div"); menu.className = "admin-mobile-menu"; more.append(menu);
  const profile = document.createElement("p"); more.append(profile);
  const forward = (text, selector) => menu.append(button(text, () => { more.close(); $(selector)?.click(); }));
  forward("Dalībnieki", '.admin-nav [data-admin-nav="participants"]');
  forward("Programma", "#adminOpenProgramNav");
  forward("Iestatījumi", '.admin-nav [data-admin-nav="settings"]');
  forward("Prezentācijas skats", '.admin-sidebar a[href*="present/"]');
  forward("Prezentācijas tālvadība", '.admin-nav [data-admin-nav="dashboard"]');
  const remoteMenuButton = menu.lastElementChild;
  remoteMenuButton.addEventListener("click", () => {
    $(".admin-remote-card")?.classList.add("mobile-expanded");
    $(".admin-remote-card .admin-mobile-collapse")?.setAttribute("aria-expanded", "true");
    $(".admin-remote-card")?.scrollIntoView({ block: "center" });
  });
  forward("Dalībnieki CSV", "#exportRegistrationsCsv");
  forward("Jautājumi CSV", "#exportQuestionsCsv");
  forward("Kopsavilkums PDF", '.admin-export-row a[target="_blank"]');
  forward("Audita žurnāls", "#adminOpenAudit");
  forward("Lietotāji", "#adminOpenUsers");
  const usersButton = menu.lastElementChild;
  forward("Iziet", "#adminLogout");
  const openMore = () => {
    profile.textContent = [$("#adminActorEmail")?.textContent, $("#adminActorRole")?.textContent].filter(Boolean).join(" · ");
    usersButton.hidden = $("#adminOpenUsers")?.hidden !== false;
    more.showModal();
  };

  const tabs = document.createElement("nav");
  tabs.className = "admin-mobile-only admin-bottom-tabs";
  tabs.setAttribute("aria-label", "Mobilā administrācijas navigācija");
  const checkin = $('.admin-sidebar a[href*="checkin/"]').cloneNode(true);
  checkin.className = ""; tabs.append(checkin);
  for (const [name, label] of [["moderation", "Moderācija"], ["dashboard", "Pults"], ["polls", "Balsojumi"]]) {
    const node = button(label, () => {}, ""); node.dataset.adminNav = name;
    node.prepend($(`.admin-nav [data-admin-nav="${name}"] svg`).cloneNode(true));
    tabs.append(node);
  }
  const moreButton = button("Vairāk", openMore, "");
  moreButton.insertAdjacentHTML("afterbegin", '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>');
  tabs.append(moreButton); $("#adminApp").append(tabs);
  const badge = document.createElement("span"); badge.className = "admin-nav-badge";
  tabs.querySelector('[data-admin-nav="moderation"]').append(badge);
  const status = document.createElement("div"); status.className = "admin-mobile-only admin-mobile-status";
  const eventStatus = document.createElement("strong"); const sync = document.createElement("span");
  status.append(eventStatus, sync); $(".admin-topbar").append(status);
  const syncChrome = () => {
    badge.textContent = $("#adminPendingBadge").textContent; badge.hidden = $("#adminPendingBadge").hidden;
    eventStatus.textContent = $("#dashEventState").textContent;
    sync.textContent = $("#dashSyncTime").textContent;
    const active = $(".admin-panel.is-active")?.dataset.adminPanel;
    tabs.querySelectorAll("[data-admin-nav]").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.adminNav === active);
      node.setAttribute("aria-current", node.dataset.adminNav === active ? "page" : "false");
    });
    moreButton.classList.toggle("is-active", ["participants", "settings"].includes(active));
  };
  for (const selector of ["#adminPendingBadge", "#dashEventState", "#dashSyncTime"]) {
    new MutationObserver(syncChrome).observe($(selector), { childList: true, attributes: true, characterData: true, subtree: true });
  }
  document.querySelectorAll(".admin-panel").forEach((node) => new MutationObserver(syncChrome).observe(node, { attributes: true, attributeFilter: ["class"] }));
  syncChrome();

  for (const [selector, text] of [[".admin-remote-card", "Prezentācijas tālvadība"], [".admin-preview-card", "Prezentācijas priekšskatījums"]]) {
    const node = $(selector);
    const toggle = button(text, () => {
      toggle.setAttribute("aria-expanded", String(node.classList.toggle("mobile-expanded")));
    }, "admin-mobile-only admin-mobile-collapse");
    toggle.setAttribute("aria-expanded", "false"); node.prepend(toggle);
  }
  $(".admin-export-row")?.closest(".admin-card").classList.add("admin-mobile-export-card");

  const filters = dialog("adminMobileFilters", "Dalībnieku filtri");
  const fields = [["participantsStatusFilter", "Statuss"], ["participantsConsentFilter", "Piekrišana"], ["participantsAttendanceFilter", "Ierašanās"]].map(([id, label]) => {
    const control = document.getElementById(id);
    const placeholder = document.createComment(id); control.before(placeholder);
    const wrapper = document.createElement("label"); wrapper.className = "admin-field";
    const title = document.createElement("span"); title.textContent = label; wrapper.append(title);
    filters.append(wrapper);
    return { control, placeholder, wrapper };
  });
  filters.append(button("Rādīt dalībniekus", () => filters.close(), "live-submit"));
  const filterButton = button("Filtri", () => filters.showModal(), "admin-mobile-only btn secondary");
  const selectButton = button("Atlasīt", () => {
    const panel = $('[data-admin-panel="participants"]');
    const selecting = panel.classList.toggle("admin-selecting");
    selectButton.textContent = selecting ? "Beigt atlasi" : "Atlasīt";
    selectButton.setAttribute("aria-pressed", String(selecting));
    if (!selecting) document.dispatchEvent(new Event("admin:clear-selection"));
  }, "admin-mobile-only btn secondary");
  selectButton.setAttribute("aria-pressed", "false");
  $(".admin-participant-toolbar").append(filterButton, selectButton);

  const program = $("#programModal");
  const form = $("#programItemForm");
  const formScreen = (editing) => {
    program.classList.toggle("mobile-editing", editing);
    if (editing && mobile.matches) {
      $("#programModal .admin-modal-body").append(form);
      form.scrollIntoView({ block: "start" });
    }
  };
  const add = button("+ Pievienot punktu", () => { $("#programFormReset").click(); formScreen(true); $("#agendaTitle").focus(); }, "admin-mobile-only live-submit");
  add.id = "adminMobileAddAgenda";
  const back = button("← Grafiks", () => formScreen(false), "admin-mobile-only btn secondary"); back.id = "adminMobileProgramBack";
  $("#programModal .admin-modal-header").append(add, back);
  for (const [id, title] of [["agendaTitle", "Pamatinformācija"], ["agendaSpeaker", "Runātājs"], ["agendaMaterialsUrl", "Materiāli"]]) {
    const heading = document.createElement("h3"); heading.className = "admin-mobile-section-title"; heading.textContent = title;
    document.getElementById(id).closest("label").before(heading);
  }
  document.addEventListener("click", (event) => {
    if (!mobile.matches) return;
    if (event.target.closest("[data-edit-agenda]")) requestAnimationFrame(() => formScreen(true));
  });
  const adaptProgramRows = () => {
    $("#programEditorList").querySelectorAll(".admin-program-row:not([data-mobile-ready])").forEach((row, index, rows) => {
      row.dataset.mobileReady = "true";
      const actions = row.querySelector(".admin-program-row-actions");
      const details = document.createElement("details"); details.className = "admin-mobile-agenda-menu";
      const summary = document.createElement("summary"); summary.textContent = "Citas darbības ···"; details.append(summary);
      // Move only secondary actions; delegated handlers remain on the same list.
      actions.querySelectorAll("[data-duplicate-agenda], [data-cancel-agenda]").forEach((node) => details.append(node));
      for (const [direction, text] of [[-1, "↑ Uz augšu"], [1, "↓ Uz leju"]]) {
        const move = button(text, () => row.dispatchEvent(new CustomEvent("admin:move-agenda", { bubbles: true, detail: { id: row.dataset.dragId, direction } })), "admin-link");
        move.disabled = direction < 0 ? index === 0 : index === rows.length - 1;
        details.append(move);
      }
      actions.append(details);
    });
  };
  // Adapt only mobile DOM; restore secondary actions when returning to desktop.
  const resetProgramRows = () => {
    $("#programEditorList").querySelectorAll("[data-mobile-ready]").forEach((row) => {
      const actions = row.querySelector(".admin-program-row-actions");
      row.querySelectorAll("[data-duplicate-agenda], [data-cancel-agenda]").forEach((node) => actions.append(node));
      row.querySelector(".admin-mobile-agenda-menu")?.remove(); delete row.dataset.mobileReady;
    });
  };
  new MutationObserver(() => { if (mobile.matches) adaptProgramRows(); }).observe($("#programEditorList"), { childList: true });
  const adapt = () => {
    fields.forEach(({ control, placeholder, wrapper }) => mobile.matches ? wrapper.append(control) : placeholder.after(control));
    $("#settingsGraphEventId").readOnly = mobile.matches;
    if (mobile.matches) adaptProgramRows();
    else { resetProgramRows(); more.close(); filters.close(); }
  };
  const graphCopy = button("Kopēt ID", async () => {
    try { await navigator.clipboard.writeText($("#settingsGraphEventId").value); graphCopy.textContent = "Nokopēts"; }
    catch { graphCopy.textContent = "Atlasiet un kopējiet ID"; $("#settingsGraphEventId").select(); }
  }, "admin-mobile-only btn secondary");
  $("#settingsGraphEventId").closest("label").after(graphCopy);
  mobile.addEventListener("change", adapt); adapt();

  // Capture before delegated business handlers: cancellation must perform no write.
  document.addEventListener("click", (event) => {
    if (!mobile.matches) return;
    const target = event.target.closest("[data-poll-close], #dashPollClose, [data-poll-present], #dashPollPresent, [data-question-present], [data-participant-reject]");
    if (!target) return;
    const message = target.matches("[data-participant-reject]") ? "Noraidīt šo dalībnieku?"
      : target.matches("[data-poll-close], #dashPollClose") ? "Noslēgt aktīvo balsojumu?" : "Mainīt saturu uz lielā ekrāna?";
    if (!window.confirm(message)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

  const focusable = (root) => [...root.querySelectorAll('button, a[href], input, select, textarea, summary, [tabindex="0"]')].filter((node) => !node.disabled && node.getClientRects().length);
  const returnFocus = new WeakMap();
  document.querySelectorAll(".admin-modal").forEach((node) => {
    node.setAttribute("role", "dialog"); node.setAttribute("aria-modal", "true");
    const title = node.querySelector("h2"); title.id ||= `${node.id}Title`; node.setAttribute("aria-labelledby", title.id);
    new MutationObserver(() => {
      const open = !node.hidden;
      if (open) { returnFocus.set(node, document.activeElement); if (mobile.matches) focusable(node)[0]?.focus(); }
      else { returnFocus.get(node)?.focus(); if (node === program) formScreen(false); }
      document.body.classList.toggle("admin-mobile-modal-open", mobile.matches && !!$(".admin-modal:not([hidden])"));
    }).observe(node, { attributes: true, attributeFilter: ["hidden"] });
  });
  document.addEventListener("keydown", (event) => {
    if (!mobile.matches || $("dialog[open]")) return;
    const modal = $(".admin-modal:not([hidden])"); if (!modal) return;
    if (event.key === "Escape") { modal.hidden = true; event.preventDefault(); }
    if (event.key !== "Tab") return;
    const items = focusable(modal); const first = items[0]; const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { last?.focus(); event.preventDefault(); }
    else if (!event.shiftKey && document.activeElement === last) { first?.focus(); event.preventDefault(); }
  });
})();
