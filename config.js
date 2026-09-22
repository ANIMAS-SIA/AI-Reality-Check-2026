window.ARC_API_BASE = "https://zoxeflvpiierezdzxwdq.supabase.co/functions/v1";
// Explicit per-tab context: a production tab never inherits a rehearsal selection.
window.ARC_EVENT_SLUG = new URLSearchParams(location.search).get("event") || "ai-reality-check-2026";
window.arcEventUrl = function (input) {
  const url = new URL(input, location.href);
  if (window.ARC_EVENT_SLUG !== "ai-reality-check-2026") url.searchParams.set("event", window.ARC_EVENT_SLUG);
  return url.href;
};
window.arcFetch = function (input, options) {
  const url = new URL(input, location.href);
  const api = new URL(window.ARC_API_BASE);
  return window.fetch(url.origin === api.origin && url.pathname.startsWith(`${api.pathname}/`) ? window.arcEventUrl(url) : input, options);
};
window.arcStorageKey = (key) => window.ARC_EVENT_SLUG === "ai-reality-check-2026" ? key : `${key}:${window.ARC_EVENT_SLUG}`;
document.addEventListener("DOMContentLoaded", () => {
  if (window.ARC_EVENT_SLUG === "ai-reality-check-2026") return;
  const banner = document.createElement("aside");
  banner.textContent = `MĒĢINĀJUMS · ${window.ARC_EVENT_SLUG} · E-pasti, kalendārs un Wallet atslēgti`;
  banner.style.cssText = "position:sticky;top:0;z-index:10000;padding:10px;background:#ffed00;color:#111;font:600 14px sans-serif;text-align:center";
  document.body.prepend(banner);
  const scopeLink = (link) => {
    if (!link?.href || link.hasAttribute("data-production-link")) return;
    const url = new URL(link.href, location.href);
    if (url.origin === location.origin) link.href = window.arcEventUrl(url);
  };
  document.querySelectorAll("a[href]").forEach(scopeLink);
  document.addEventListener("click", (event) => scopeLink(event.target.closest("a[href]")), true);
});
window.SUPABASE_URL = "https://zoxeflvpiierezdzxwdq.supabase.co";
window.SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpveGVmbHZwaWllcmV6ZHp4d2RxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MDMwNjYsImV4cCI6MjEwMDM3OTA2Nn0.YNT69_-x0iA4hLKRNkoAiJxbfrJXJ4_N-NI96lzCAzo";
window.C360_EMBED_API_KEY = "c360_xBPYzQ1x-rvhkuT6aijgrpUc39NPYGmfXGd5-fEb52o";
