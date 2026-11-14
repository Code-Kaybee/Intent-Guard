export function initializeWorkspace() {
  const root = document.documentElement;
  const sidebar = document.getElementById("workspace-sidebar");
  const main = document.querySelector("main");
  const toggle = document.getElementById("sidebar-toggle");
  const close = document.getElementById("sidebar-close");
  const backdrop = document.getElementById("sidebar-backdrop");
  const appearance = document.getElementById("theme-select");
  const mobile = matchMedia("(max-width: 900px)");
  let drawerOpen = false;

  function syncAppearance() {
    appearance.value = window.IntentGuardTheme.preference;
    document.getElementById("theme-icon").setAttribute("href", `#i-${{ light: "sun", dark: "moon", system: "monitor" }[appearance.value]}`);
  }
  appearance.addEventListener("change", () => window.IntentGuardTheme.set(appearance.value));
  document.addEventListener("intentguard:appearancechange", syncAppearance);
  syncAppearance();

  function renderNavigation() {
    const open = mobile.matches && drawerOpen;
    const expanded = mobile.matches ? open : root.dataset.sidebar !== "collapsed";
    root.dataset.drawer = open ? "open" : "closed";
    sidebar.inert = mobile.matches && !open;
    main.inert = open;
    backdrop.hidden = !open;
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.setAttribute("aria-label", mobile.matches ? "Open navigation" : `${expanded ? "Collapse" : "Expand"} sidebar`);
    toggle.title = toggle.getAttribute("aria-label");
    if (open) {
      sidebar.setAttribute("role", "dialog");
      sidebar.setAttribute("aria-modal", "true");
    } else {
      sidebar.removeAttribute("role");
      sidebar.removeAttribute("aria-modal");
    }
  }
  function closeDrawer(target = toggle) {
    drawerOpen = false;
    renderNavigation();
    target.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => {
    if (mobile.matches) {
      drawerOpen = true;
      renderNavigation();
      close.focus();
    } else {
      root.dataset.sidebar = root.dataset.sidebar === "collapsed" ? "expanded" : "collapsed";
      try { localStorage.setItem("intentguard-sidebar", root.dataset.sidebar); } catch {}
      renderNavigation();
    }
  });
  close.addEventListener("click", () => closeDrawer());
  backdrop.addEventListener("click", () => closeDrawer());
  mobile.addEventListener("change", () => {
    const focusWasInside = sidebar.contains(document.activeElement);
    drawerOpen = false;
    renderNavigation();
    if (mobile.matches && focusWasInside) toggle.focus();
  });
  document.addEventListener("keydown", (event) => {
    if (!mobile.matches || !drawerOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeDrawer();
    }
    if (event.key === "Tab") {
      const controls = [...sidebar.querySelectorAll('a[href], button:not(:disabled), [tabindex="0"]')]
        .filter((element) => element.getClientRects().length);
      const first = controls[0];
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  for (const link of sidebar.querySelectorAll('a[href^="#"]')) {
    link.addEventListener("click", () => {
      if (!mobile.matches || !drawerOpen) return;
      const target = document.getElementById(link.hash.slice(1));
      if (target) target.tabIndex = -1;
      closeDrawer(target ?? toggle);
    });
  }
  renderNavigation();
}
