(() => {
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: light)");
  const normalize = (value) => ["light", "dark"].includes(value) ? value : "system";
  let preference = "system";
  try {
    preference = normalize(localStorage.getItem("intentguard-theme"));
    root.dataset.sidebar = localStorage.getItem("intentguard-sidebar") === "collapsed" ? "collapsed" : "expanded";
  } catch {}

  function apply() {
    const theme = preference === "system" ? system.matches ? "light" : "dark" : preference;
    root.dataset.theme = theme;
    root.dataset.themePreference = preference;
    document.querySelector('meta[name="theme-color"]').content = theme === "light" ? "#f6f5f0" : "#000000";
    document.dispatchEvent(new Event("intentguard:appearancechange"));
  }

  window.IntentGuardTheme = {
    get preference() { return preference; },
    set(value) {
      preference = normalize(value);
      try { localStorage.setItem("intentguard-theme", preference); } catch {}
      apply();
    },
  };
  system.addEventListener("change", () => { if (preference === "system") apply(); });
  window.addEventListener("storage", (event) => {
    if (event.key === "intentguard-theme" || event.key === null) {
      preference = normalize(event.newValue);
      apply();
    }
  });
  apply();
})();
