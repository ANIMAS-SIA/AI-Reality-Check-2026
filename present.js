(function () {
  if (document.body.dataset.page !== "present") return;

  let lastSnapshot = null;

  function el(id) { return document.getElementById(id); }

  function qrUrl(targetUrl, size = 320) {
    return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=12&data=${encodeURIComponent(targetUrl)}`;
  }

  function fmtTime(iso) {
    if (!iso) return "";
    return new Intl.DateTimeFormat("lv-LV", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Riga" }).format(new Date(iso));
  }

  function meterMarkup(options) {
    return `<div class="present-meter">${options.map((option) => `
      <div class="present-meter-row">
        <span>${option.label}</span>
        <span class="present-meter-track"><span style="width:${option.percent || 0}%"></span></span>
        <strong>${option.percent || 0}%</strong>
      </div>
    `).join("")}</div>`;
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
    const words = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
    return `<div class="present-word-cloud">${words.map(([word, count]) => {
      const size = 20 + Math.round((count / max) * 46);
      return `<span style="font-size:${size}px">${word}</span>`;
    }).join(" ")}</div>`;
  }

  function textListMarkup(responses) {
    if (!responses.length) return `<p class="live-empty">Vēl nav atbilžu.</p>`;
    return `<ul class="present-text-list">${responses.slice(0, 12).map((text) => `<li>${text}</li>`).join("")}</ul>`;
  }

  function renderWaiting(snapshot) {
    const visible = snapshot.state.qr_visible;
    el("presentWaitingQr").hidden = !visible;
    if (visible) {
      const url = `${window.location.origin}/live/`;
      el("presentWaitingQrImg").src = qrUrl(url);
      el("presentWaitingUrl").textContent = url.replace(/^https?:\/\//, "");
    }
    const next = snapshot.agenda_item;
    el("presentWaitingNext").textContent = next ? `Tālāk: ${next.title} · ${fmtTime(next.starts_at)}` : "Programma sāksies drīz.";
  }

  function renderAgenda(snapshot) {
    const item = snapshot.agenda_item;
    if (!item) return;
    setText("presentAgendaTitle", item.title);
    setText("presentAgendaSpeaker", [item.speaker_name, item.speaker_role, item.speaker_company].filter(Boolean).join(" · "));
    setText("presentAgendaTime", `${fmtTime(item.starts_at)}–${fmtTime(item.ends_at)}`);
    const visible = snapshot.state.qr_visible;
    el("presentAgendaQr").hidden = !visible;
    if (visible) el("presentAgendaQrImg").src = qrUrl(`${window.location.origin}/live/?view=program`);
  }

  function renderPollQuestion(snapshot) {
    const poll = snapshot.poll;
    if (!poll) return;
    setText("presentPollQuestionTitle", poll.poll.title);
    const isText = Boolean(poll.text_responses);
    el("presentPollQuestionOptions").innerHTML = isText
      ? `<p class="live-empty">Atbildi ar savu tālruni — atbildes parādīsies rezultātos.</p>`
      : poll.options.map((option, index) => `
        <div class="present-option-chip">
          <span class="poll-letter">${String.fromCharCode(65 + index)}</span>
          <strong>${option.label}</strong>
        </div>
      `).join("");
    setText("presentPollVoteCount", String(poll.total_votes || 0));
    const visible = snapshot.state.qr_visible;
    el("presentPollQr").hidden = !visible;
    if (visible) el("presentPollQrImg").src = qrUrl(`${window.location.origin}/live/?view=program`);
  }

  function renderPollResults(snapshot) {
    const poll = snapshot.poll;
    if (!poll) return;
    setText("presentPollResultsTitle", poll.poll.title);
    el("presentPollResultsBody").innerHTML = poll.text_responses
      ? (poll.poll.poll_type === "word_cloud" ? wordCloudMarkup(poll.text_responses) : textListMarkup(poll.text_responses))
      : meterMarkup(poll.options);
    setText("presentPollResultsCount", String(poll.total_votes || 0));
  }

  function renderQuestions(snapshot) {
    const single = el("presentQuestionSingle");
    const list = el("presentQuestionList");
    if (snapshot.question) {
      single.hidden = false;
      list.innerHTML = "";
      setText("presentQuestionBody", `"${snapshot.question.body}"`);
      setText("presentQuestionMeta", `${snapshot.question.is_anonymous ? "Anonīms" : "Dalībnieks"} · ▲ ${snapshot.question.vote_count || 0}`);
      return;
    }
    single.hidden = true;
    const top = snapshot.top_questions || [];
    list.innerHTML = top.length
      ? top.map((question) => `
        <article class="present-question-row">
          <span class="admin-vote-badge">▲ ${question.vote_count || 0}</span>
          <p>${question.body}</p>
        </article>
      `).join("")
      : `<p class="live-empty">Vēl nav apstiprinātu jautājumu.</p>`;
  }

  function renderAnnouncement(snapshot) {
    setText("presentAnnouncementText", snapshot.state.announcement_text || "—");
  }

  function renderResults(snapshot) {
    const summary = snapshot.summary;
    setText("presentResultsSummary", summary
      ? `${summary.participant_count || 0} dalībnieki dalījās ar savu MI gatavību konferences laikā.`
      : "Rezultāti tiek apkopoti...");
  }

  function renderClosing(snapshot) {
    const visible = snapshot.state.qr_visible;
    el("presentClosingQr").hidden = !visible;
    if (visible) {
      const url = `${window.location.origin}/rezultati/`;
      el("presentClosingQrImg").src = qrUrl(url);
      el("presentClosingUrl").textContent = url.replace(/^https?:\/\//, "");
    }
  }

  const RENDERERS = {
    waiting: renderWaiting,
    agenda: renderAgenda,
    poll_question: renderPollQuestion,
    poll_results: renderPollResults,
    questions: renderQuestions,
    announcement: renderAnnouncement,
    results: renderResults,
    closing: renderClosing,
  };

  function applySnapshot(snapshot) {
    lastSnapshot = snapshot;
    document.querySelectorAll("[data-present-mode]").forEach((section) => {
      section.classList.toggle("is-active", section.dataset.presentMode === snapshot.state.mode);
    });
    (RENDERERS[snapshot.state.mode] || renderWaiting)(snapshot);
    el("presentConnection").hidden = true;
  }

  async function refreshSnapshot() {
    try {
      const response = await fetch(`${API_BASE}/presentation`);
      if (!response.ok) throw new Error("bad status");
      applySnapshot(await response.json());
    } catch (error) {
      // Keep showing the last known snapshot instead of a blank/error screen.
      if (lastSnapshot) el("presentConnection").hidden = false;
      console.warn(error);
    }
  }

  function requestFullscreenToggle() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => null);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key.toLowerCase() === "f") requestFullscreenToggle();
    if (event.key === "Escape" && document.fullscreenElement) document.exitFullscreen?.();
  });

  document.addEventListener("DOMContentLoaded", () => {
    refreshSnapshot();
    window.setInterval(refreshSnapshot, 5000);
    subscribeLiveRealtime(() => refreshSnapshot());
  });
})();
