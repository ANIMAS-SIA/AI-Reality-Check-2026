(function () {
  if (document.body.dataset.page !== "checkin") return;

  const API_BASE = window.ARC_API_BASE || "";
  const supabaseClient = (window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY)
    ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
    : null;

  let scanner = null;
  let scanLocked = false;

  function el(id) { return document.getElementById(id); }
  function setText(id, value) { el(id).textContent = value; }

  async function getAccessToken() {
    if (!supabaseClient) return null;
    const { data } = await supabaseClient.auth.getSession();
    return data.session?.access_token || null;
  }

  async function checkinFetch(path, options = {}) {
    const token = await getAccessToken();
    const response = await window.arcFetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || "Check-in pieprasījums neizdevās.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showLogin(message = "") {
    el("checkinLogin").hidden = false;
    el("checkinWorkspace").hidden = true;
    el("checkinAccount").hidden = true;
    setText("checkinLoginStatus", message);
  }

  function showWorkspace(actor) {
    el("checkinLogin").hidden = true;
    el("checkinWorkspace").hidden = false;
    el("checkinAccount").hidden = false;
    setText("checkinActor", actor.displayName || actor.email || "Pārbaudītājs");
  }

  async function stopScanner() {
    if (!scanner) return;
    try {
      const state = scanner.getState();
      if (state === 2 || state === 3) await scanner.stop();
      scanner.clear();
    } catch (_) {
      // The camera may already have stopped after a browser interruption.
    }
    scanner = null;
  }

  function extractToken(decodedText) {
    const value = String(decodedText || "").trim();
    if (!value) return "";
    try {
      const url = new URL(value);
      return (url.searchParams.get("token") || "").trim();
    } catch (_) {
      return value;
    }
  }

  async function handleScan(decodedText) {
    if (scanLocked) return;
    scanLocked = true;
    const token = extractToken(decodedText);
    await stopScanner();

    if (!token) {
      renderError("QR kodā nav atrodams dalībnieka tokens.");
      return;
    }

    setText("checkinCameraStatus", "Reģistrē ierašanos…");
    try {
      const data = await checkinFetch("/checkin-scan", {
        method: "POST",
        body: JSON.stringify({
          token,
          deviceLabel: navigator.userAgent.slice(0, 120),
        }),
      });
      renderResult(data);
      if (navigator.vibrate) navigator.vibrate(data.result === "accepted" ? 80 : [60, 50, 60]);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await supabaseClient?.auth.signOut();
        showLogin("Sesija beigusies. Lūdzu, ielogojies vēlreiz.");
        return;
      }
      renderError(error.message || "QR kodu neizdevās reģistrēt.");
    }
  }

  function renderResult(data) {
    const participant = data.participant || {};
    const accepted = data.result === "accepted";
    const duplicate = data.result === "duplicate";
    el("checkinResultView").classList.toggle("is-warning", duplicate);
    el("checkinResultView").classList.toggle("is-error", !accepted && !duplicate);
    setText("checkinResultMark", accepted ? "✓" : duplicate ? "↻" : "!");
    setText("checkinResultKicker", accepted ? "Ierašanās reģistrēta" : duplicate ? "Atkārtots skenējums" : "Check-in nav pieņemts");
    setText("checkinParticipantName", participant.name || "Nezināms dalībnieks");
    setText("checkinParticipantCompany", participant.company_name || "Uzņēmums nav norādīts");
    setText("checkinResultNote", accepted
      ? "Dalībnieks atzīmēts kā ieradies."
      : duplicate
        ? "Šis dalībnieks jau iepriekš bija atzīmēts kā ieradies. Skenējums ir saglabāts žurnālā."
        : "Dalībnieka statuss neļauj reģistrēt ierašanos. Skenējums ir saglabāts žurnālā.");
    el("checkinScannerView").hidden = true;
    el("checkinResultView").hidden = false;
    el("checkinNext").focus();
  }

  function renderError(message) {
    el("checkinResultView").classList.remove("is-warning");
    el("checkinResultView").classList.add("is-error");
    setText("checkinResultMark", "!");
    setText("checkinResultKicker", "QR kods nav pieņemts");
    setText("checkinParticipantName", "Neizdevās noskenēt");
    setText("checkinParticipantCompany", "");
    setText("checkinResultNote", message);
    el("checkinScannerView").hidden = true;
    el("checkinResultView").hidden = false;
    el("checkinNext").focus();
  }

  async function startScanner() {
    scanLocked = false;
    el("checkinResultView").hidden = true;
    el("checkinScannerView").hidden = false;
    el("checkinRetryCamera").hidden = true;
    setText("checkinCameraStatus", "Ieslēdz kameru…");

    if (!window.Html5Qrcode) {
      setText("checkinCameraStatus", "QR skeneri neizdevās ielādēt. Pārbaudi interneta savienojumu.");
      el("checkinRetryCamera").hidden = false;
      return;
    }

    await stopScanner();
    scanner = new window.Html5Qrcode("checkinReader", {
      formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE],
    });

    try {
      await scanner.start(
        { facingMode: "environment" },
        {
          fps: 12,
          qrbox: (width, height) => {
            const size = Math.floor(Math.min(width, height) * 0.68);
            return { width: size, height: size };
          },
          aspectRatio: 1,
        },
        handleScan,
        () => {},
      );
      setText("checkinCameraStatus", "Pavērs kameru pret dalībnieka QR kodu.");
    } catch (_) {
      setText("checkinCameraStatus", "Kameru neizdevās ieslēgt. Atļauj kameras piekļuvi pārlūka iestatījumos.");
      el("checkinRetryCamera").hidden = false;
    }
  }

  async function validateSession() {
    const actor = await checkinFetch("/checkin-scan?action=whoami");
    showWorkspace(actor);
    await startScanner();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const button = el("checkinLoginButton");
    button.disabled = true;
    setText("checkinLoginStatus", "Pieslēdzas…");
    try {
      if (!supabaseClient) throw new Error("Supabase nav konfigurēts.");
      const { error } = await supabaseClient.auth.signInWithPassword({
        email: el("checkinEmail").value.trim(),
        password: el("checkinPassword").value,
      });
      if (error) throw error;
      await validateSession();
    } catch (error) {
      await supabaseClient?.auth.signOut();
      showLogin(error.message === "Invalid login credentials"
        ? "Nepareizs e-pasts vai parole."
        : (error.message || "Pieslēgties neizdevās."));
    } finally {
      button.disabled = false;
    }
  }

  async function logout() {
    await stopScanner();
    await supabaseClient?.auth.signOut();
    showLogin();
  }

  el("checkinLoginForm").addEventListener("submit", handleLogin);
  el("checkinLogout").addEventListener("click", logout);
  el("checkinNext").addEventListener("click", startScanner);
  el("checkinRetryCamera").addEventListener("click", startScanner);
  window.addEventListener("pagehide", stopScanner);

  (async function boot() {
    if (!API_BASE || !supabaseClient) {
      showLogin("Check-in sistēma nav konfigurēta.");
      return;
    }
    const { data } = await supabaseClient.auth.getSession();
    if (!data.session) {
      showLogin();
      return;
    }
    try {
      await validateSession();
    } catch (_) {
      await supabaseClient.auth.signOut();
      showLogin("Šim kontam nav check-in tiesību.");
    }
  })();
})();
