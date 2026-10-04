// Arranque: preferencias, módulos y navegación SPA de Twitch. Decide qué módulos corren y los avisa cuando cambia el canal.
(function () {
  const D = window.__decatron;
  const RESERVED = new Set(["directory", "videos", "settings", "downloads", "friends", "inventory", "wallet", "subscriptions", "drops", "search", "p", "jobs", "turbo", "store", "moderator", "popout", "embed", "u", "clip", "collections", "team", "event", "prime", "bits", "products", "creatorcamp", "broadcast", "dashboard", "login", "signup"]);

  const started = new Set();
  let lastPath = null;

  // ───────────── canal actual
  function channelFromPath() {
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length === 0) return null;
    // Chat en ventana aparte: /popout/<login>/chat y /embed/<login>/chat (no hay player, pero sí chat)
    if ((seg[0] === "popout" || seg[0] === "embed") && seg[2] === "chat" && seg[1]) return seg[1].toLowerCase();
    if (RESERVED.has(seg[0].toLowerCase())) return null;
    if (seg.length > 1 && !["about", "schedule", "videos", "clips"].includes(seg[1])) return null;
    return seg[0].toLowerCase();
  }

  // ───────────── módulos
  /** Arranca los módulos que están encendidos y apaga los que no, sin tocar a los demás */
  function syncModules() {
    for (const m of D.modules.values()) {
      const on = !m.soon && D.isEnabled(m.id);
      if (on && !started.has(m.id)) {
        started.add(m.id);
        try { m.start && m.start(); m.onChannel && m.onChannel(D.channel); } catch (e) { console.warn("[decatron] arranque de", m.id, e); }
      } else if (!on && started.has(m.id)) {
        started.delete(m.id);
        try { m.stop && m.stop(); } catch (e) { console.warn("[decatron] apagado de", m.id, e); }
      }
    }
    D.emit("module-update", null);
  }

  function onRoute() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const login = channelFromPath();
    if (login === D.channel) return;
    D.channel = login;
    for (const id of started) {
      const m = D.modules.get(id);
      try { m.onChannel && m.onChannel(login); } catch (e) { console.warn("[decatron] canal en", id, e); }
    }
    if (!login) D.sw({ type: "channel", login: null, enabled: false });
    D.emit("channel", login);
  }

  // ───────────── popup de la barra del navegador
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg) return;
      if (msg.type === "state") {
        const modules = {};
        for (const m of D.modules.values()) modules[m.id] = { enabled: !m.soon && D.isEnabled(m.id), soon: !!m.soon, name: m.name(), status: m.status ? m.status() : null };
        reply({ login: D.channel, modules });
        return true;
      }
      if (msg.type === "openPanel") { D.openPanel(msg.tab); reply({ ok: true }); return true; }
    });
  } catch { /* fuera de una extensión */ }

  (async () => {
    await D.loadPrefs();
    console.info(`[decatron] Decatron ${D.version} cargada`);
    D.channel = channelFromPath();
    lastPath = location.pathname;
    syncModules();
    D.shell.start();
    D.on("module-settings", syncModules);
    // Twitch navega con pushState y el content script vive en un mundo aislado (no
    // puede interceptar el history de la página), así que se vigila la URL.
    window.addEventListener("popstate", () => setTimeout(onRoute, 0));
    setInterval(onRoute, 1500);
  })();
})();
