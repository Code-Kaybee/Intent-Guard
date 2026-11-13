(() => {
  let theme;
  try { theme = localStorage.getItem("intentguard-theme"); } catch {}
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
})();
