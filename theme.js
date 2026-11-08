/* Appearance is intentionally client-side: no account, cookies, or remote service. */
(() => {
  "use strict";
  const key = "attendance-appearance";
  const allowed = new Set(["auto", "light", "dark"]);
  const media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  let preference = "auto";
  try {
    const stored = window.localStorage.getItem(key);
    if (allowed.has(stored)) preference = stored;
  } catch { /* Private-browsing or restricted storage: use Auto. */ }

  function resolve() {
    return preference === "auto" ? (media?.matches ? "dark" : "light") : preference;
  }
  function apply(notify = false) {
    const mode = resolve();
    const changed = document.documentElement.dataset.theme !== mode;
    document.documentElement.dataset.theme = mode;
    document.documentElement.style.colorScheme = mode;
    const bar = document.querySelector('meta[name="theme-color"]');
    if (bar) bar.content = mode === "dark" ? "#131e26" : "#faf9f6";
    if (notify && changed) window.dispatchEvent(new Event("attendance-theme-change"));
  }

  apply(); // Head-loaded script: choose the correct background before the page paints.
  document.addEventListener("DOMContentLoaded", () => {
    const select = document.getElementById("themeMode");
    if (!select) return;
    select.value = preference;
    select.addEventListener("change", () => {
      if (!allowed.has(select.value)) return;
      preference = select.value;
      try { window.localStorage.setItem(key, preference); } catch { /* Optional preference. */ }
      apply(true);
    });
  });
  const onSystemChange = () => { if (preference === "auto") apply(true); };
  if (media?.addEventListener) media.addEventListener("change", onSystemChange);
  else if (media?.addListener) media.addListener(onSystemChange);
})();
