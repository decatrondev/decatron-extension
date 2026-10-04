// La carcasa de Decatron en la página: un botón en el player y un panel (modal) con una pestaña por módulo.
// El panel vive en un Shadow DOM para que ni los estilos de Twitch lo rompan ni los nuestros rompan a Twitch.
(function () {
  const D = window.__decatron;
  const { h, t } = D;

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3.5 2.5h6a7.5 7.5 0 0 1 0 15h-6v-15Zm2.4 2.4v10.2h3.6a5.1 5.1 0 0 0 0-10.2H5.9Z"/></svg>`;

  const shell = {
    button: null,
    wrap: null,
    host: null,
    root: null,
    open: false,
    tab: null,
    cleanup: null,
  };

  // ───────────── botón en el player
  function findControls() {
    return document.querySelector('.player-controls__right-control-group, [data-a-target="player-controls"] .player-controls__right-control-group');
  }

  function buildButton() {
    const button = h("button", { class: "dct-btn", "aria-label": t("button.title"), onclick: (e) => { e.stopPropagation(); shell.toggle(); } });
    button.append(D.svg(ICON), h("span", { class: "dct-dot" }));
    const wrap = h("div", { class: "dct-btn-wrap" }, button);
    shell.button = button;
    shell.wrap = wrap;
  }

  function mountButton() {
    const controls = findControls();
    if (!controls) return;
    if (!shell.wrap) buildButton();
    if (document.contains(shell.wrap) && controls.contains(shell.wrap)) return;
    const settings = controls.querySelector('button[data-a-target="player-settings-button"]');
    if (settings && settings.parentElement && settings.parentElement.parentElement === controls) controls.insertBefore(shell.wrap, settings.parentElement);
    else controls.insertBefore(shell.wrap, controls.firstChild);
  }

  /** Punto de color y texto del botón según lo que esté pasando en los módulos */
  function paintButton() {
    if (!shell.button) return;
    let activeText = null;
    let live = false;
    for (const m of D.modules.values()) {
      if (m.soon || !D.isEnabled(m.id)) continue;
      const s = m.status ? m.status() : null;
      if (s && s.active && !activeText) activeText = s.text || m.name();
      if (s && s.live) live = true;
    }
    shell.button.classList.toggle("dct-active", !!activeText);
    shell.button.classList.toggle("dct-live", live);
    shell.button.title = activeText ? t("button.titleActive", { what: activeText }) : t("button.title");
  }

  // ───────────── panel
  function ensureHost() {
    if (shell.host && document.contains(shell.host)) return;
    shell.host = h("div", { id: "decatron-root" });
    shell.root = shell.host.attachShadow({ mode: "open" });
    shell.root.append(h("link", { rel: "stylesheet", href: chrome.runtime.getURL("panel.css") }));
    document.body.append(shell.host);
  }

  function moduleList() {
    return [...D.modules.values()].sort((a, b) => (a.order || 99) - (b.order || 99));
  }

  function renderPanel() {
    ensureHost();
    if (shell.cleanup) { try { shell.cleanup(); } catch { /* el módulo ya no estaba */ } shell.cleanup = null; }
    for (const n of [...shell.root.querySelectorAll(".backdrop")]) n.remove();

    const mods = moduleList();
    if (!shell.tab || !D.modules.has(shell.tab)) shell.tab = (mods.find((m) => !m.soon) || mods[0]).id;
    const current = D.modules.get(shell.tab);

    const nav = h("nav", { class: "nav", role: "tablist" }, mods.map((m) => {
      const s = !m.soon && D.isEnabled(m.id) && m.status ? m.status() : null;
      return h("button", {
        class: "nav-item" + (m.id === shell.tab ? " on" : ""), role: "tab", "aria-selected": String(m.id === shell.tab),
        onclick: () => { shell.tab = m.id; renderPanel(); },
      },
        h("span", { class: "nav-icon" }),
        h("span", { class: "nav-name" }, m.name()),
        m.soon ? h("span", { class: "tag" }, t("panel.soonShort")) : h("span", { class: "nav-dot" + (s && s.active ? " active" : "") + (D.isEnabled(m.id) ? "" : " off") }));
    }));
    [...nav.children].forEach((btn, i) => { if (mods[i].icon) btn.firstChild.append(D.svg(mods[i].icon)); });

    const body = h("div", { class: "body" });
    const enabled = !current.soon && D.isEnabled(current.id);
    const toggle = current.soon ? null : h("label", { class: "switch", title: enabled ? t("panel.module.on") : t("panel.module.off") },
      h("input", { type: "checkbox", checked: enabled, onchange: (e) => { D.setModuleSettings(current.id, { enabled: e.target.checked }); renderPanel(); } }),
      h("span", { class: "track" }));

    const dialog = h("div", { class: "dialog", role: "dialog", "aria-modal": "true", "aria-label": t("panel.title") },
      h("aside", { class: "side" },
        h("div", { class: "brand" }, h("span", { class: "brand-mark" }), h("span", { class: "brand-name" }, t("brand"))),
        nav,
        h("div", { class: "side-foot" }, D.channel ? t("panel.channel", { login: D.channel }) : t("panel.noChannel"), h("br"), `v${D.version}`)),
      h("main", { class: "content" },
        h("header", { class: "head" },
          h("div", { class: "head-text" }, h("h2", null, current.name()), h("p", null, current.description ? current.description() : "")),
          toggle,
          h("button", { class: "close", "aria-label": t("panel.close"), onclick: () => shell.close() }, "✕")),
        body));
    dialog.querySelector(".brand-mark").append(D.svg(ICON));

    // Que las teclas escritas aquí no lleguen a los atajos de Twitch (f = pantalla completa, m = silencio...)
    for (const type of ["keydown", "keyup", "keypress"]) dialog.addEventListener(type, (e) => { if (e.key === "Escape" && type === "keydown") { shell.close(); return; } e.stopPropagation(); });
    const backdrop = h("div", { class: "backdrop", onmousedown: (e) => { if (e.target === backdrop) shell.close(); } }, dialog);
    shell.root.append(backdrop);
    dialog.setAttribute("tabindex", "-1");
    dialog.focus({ preventScroll: true });

    if (current.soon) body.append(h("p", { class: "soon" }, current.description ? current.description() : "", h("br"), h("b", null, t("panel.soon"))));
    else if (!enabled) body.append(h("p", { class: "muted" }, t("panel.module.off")));
    else if (current.renderPanel) shell.cleanup = current.renderPanel(body, D) || null;

    paintButton();
  }

  /** Escape cierra el panel aunque el foco no esté dentro (al cambiar de pestaña el panel se redibuja y el foco se pierde) */
  const onEscape = (e) => { if (e.key === "Escape" && shell.open) { e.preventDefault(); e.stopPropagation(); shell.close(); } };

  shell.show = (tab) => {
    if (tab) shell.tab = tab;
    if (!shell.open) document.addEventListener("keydown", onEscape, true);
    shell.open = true;
    renderPanel();
  };
  shell.close = () => {
    document.removeEventListener("keydown", onEscape, true);
    shell.open = false;
    if (shell.cleanup) { try { shell.cleanup(); } catch { /* ya no estaba */ } shell.cleanup = null; }
    if (shell.root) for (const n of [...shell.root.querySelectorAll(".backdrop")]) n.remove();
  };
  shell.toggle = () => (shell.open ? shell.close() : shell.show());

  // ───────────── arranque
  shell.start = () => {
    mountButton();
    setInterval(() => { mountButton(); paintButton(); }, 1000);
    D.on("module-update", paintButton);
    D.on("module-settings", paintButton);
  };

  D.shell = shell;
  D.openPanel = (tab) => shell.show(tab);
})();
