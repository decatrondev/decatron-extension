// Orquestador: detecta el canal, pregunta al backend si ofrece traducción, monta la UI
// en el player y, cuando el espectador elige idioma, se une al hub y reproduce.
(function () {
  const API = "https://decatron.net";
  const HUB = "wss://decatron.net/hubs/translation";
  const RESERVED = new Set(["directory", "videos", "settings", "downloads", "friends", "inventory", "wallet", "subscriptions", "drops", "search", "p", "jobs", "turbo", "store", "moderator", "popout", "embed", "u", "clip", "collections", "team", "event", "prime", "bits", "products", "creatorcamp", "broadcast", "dashboard", "login", "signup"]);

  const DEFAULT_PREFS = { preferredLang: null, backgroundVolume: 0.15, delaySec: 0, captions: true, captionSource: false, captionSize: 22, autoJoin: true };
  let prefs = { ...DEFAULT_PREFS };

  let current = null;   // sesión por canal: { login, ui, player, hub, selected, pollTimer }
  let lastPath = null;

  // ───────────── preferencias
  function loadPrefs() {
    return new Promise((resolve) => {
      try { chrome.storage.sync.get(DEFAULT_PREFS, (v) => { prefs = { ...DEFAULT_PREFS, ...v }; resolve(prefs); }); }
      catch { resolve(prefs); }
    });
  }
  function savePrefs(patch) {
    Object.assign(prefs, patch);
    try { chrome.storage.sync.set(patch); } catch {}
    if (current) {
      current.player.backgroundVolume = prefs.backgroundVolume;
      current.player.delaySec = prefs.delaySec;
      current.ui.prefs = prefs;
      current.ui.applyCaptionPrefs();
      if (!prefs.captions) current.ui.showCaption(null, 0);
    }
  }
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const patch = {};
      for (const k of Object.keys(changes)) patch[k] = changes[k].newValue;
      Object.assign(prefs, patch);
      if (current) { current.player.backgroundVolume = prefs.backgroundVolume; current.player.delaySec = prefs.delaySec; current.ui.prefs = prefs; current.ui.applyCaptionPrefs(); }
    });
  } catch {}

  // ───────────── canal actual
  function channelFromPath() {
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length === 0) return null;
    // /popout/<login>/chat y /moderator/<login> no son el player; /<login> y /<login>/... sí.
    if (RESERVED.has(seg[0].toLowerCase())) return null;
    if (seg.length > 1 && !["about", "schedule", "videos", "clips"].includes(seg[1])) return null;
    return seg[0].toLowerCase();
  }

  function findPlayer() {
    const video = document.querySelector(".video-player video, video[playsinline]");
    const root = video && (video.closest(".video-player__container") || video.closest(".video-player") || video.parentElement);
    const controls = document.querySelector('.player-controls__right-control-group, [data-a-target="player-controls"] .player-controls__right-control-group');
    if (!video || !root || !controls) return null;
    return { video, root, controls };
  }

  // El fetch va por el service worker: en MV3 el content script hereda el origen de
  // twitch.tv y el CORS lo frena; el worker usa los host_permissions.
  function fetchPublic(login) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "fetchPublic", login }, (r) => {
          if (chrome.runtime.lastError) { resolve(null); return; }
          resolve(r && r.ok ? r.data : null);
        });
      } catch { resolve(null); }
    });
  }

  // ───────────── ciclo de vida por canal
  async function mount(login) {
    const info = await fetchPublic(login);
    if (!info || !info.enabled) { setBadge(login, null); return; }

    // El player puede tardar en montarse tras navegar; reintentar un rato.
    let p = null;
    for (let i = 0; i < 40 && !p; i++) { p = findPlayer(); if (!p) await sleep(250); }
    if (!p) return;
    if (current && current.login === login) return;
    if (current) unmount();

    const ui = new window.__decatronPlayerUi(p.root, p.controls, prefs);
    const player = new window.__decatronPlayer(p.video);
    player.backgroundVolume = prefs.backgroundVolume;
    player.delaySec = prefs.delaySec;
    player.onsegment = (meta, dur) => ui.showCaption(meta, dur);
    player.onaudioblocked = (b) => ui.setAudioBlocked(b);
    ui.onunlock = () => player.ensureContext();
    p.video.addEventListener("volumechange", () => player.noteUserVolume());

    current = { login, ui, player, hub: null, selected: null, info, pollTimer: null, video: p.video, controls: p.controls };
    ui.setState({ enabled: true, live: !!info.live, languages: info.languages || [], listeners: {} });
    setBadge(login, info);

    ui.onselect = (lang) => select(lang, true);
    ui.onprefs = (patch) => savePrefs(patch);

    // Si el espectador ya eligió idioma en este canal (o tiene uno preferido), unirse solo.
    const remembered = await getChannelLang(login);
    const want = remembered !== undefined ? remembered : (prefs.autoJoin ? prefs.preferredLang : null);
    if (want && (info.languages || []).includes(want)) select(want, false);

    // Estado del canal cada 30 s mientras no estemos en el hub (para ver cuándo se enciende).
    current.pollTimer = setInterval(async () => {
      if (!current || current.hub) return;
      const i2 = await fetchPublic(login);
      if (i2 && current) { current.info = i2; ui.setState({ live: !!i2.live, languages: i2.languages || [] }); }
    }, 30000);

    // Twitch re-renderiza los controles (teatro, pantalla completa): volver a montar el botón si desaparece.
    current.observer = new MutationObserver(() => {
      if (!current) return;
      if (!document.contains(current.ui.wrap)) {
        const p2 = findPlayer();
        if (p2) { p2.controls.insertBefore(current.ui.wrap, p2.controls.firstChild); }
      }
    });
    current.observer.observe(document.body, { childList: true, subtree: true });
  }

  function unmount() {
    if (!current) return;
    leave();
    if (current.pollTimer) clearInterval(current.pollTimer);
    if (current.observer) current.observer.disconnect();
    current.ui.destroy();
    current.player.destroy();
    current = null;
  }

  async function select(lang, byUser) {
    if (!current) return;
    if (byUser) { setChannelLang(current.login, lang); if (lang) savePrefs({ preferredLang: lang }); }
    if (!lang) { leave(); return; }
    if (current.selected === lang && current.hub) return;
    current.selected = lang;
    current.ui.setState({ selected: lang, connection: "connecting" });
    // El clic del usuario habilita el audio; sin gesto Chrome bloquea el AudioContext y
    // ensureContext lo reporta para mostrar el aviso de "Activar audio".
    await current.player.ensureContext();
    await joinHub(lang);
  }

  async function joinHub(lang) {
    if (current.hub) { current.hub.close(); current.hub = null; }
    const hub = new window.__decatronSignalR(HUB);
    current.hub = hub;
    const sess = current;
    hub.onstate = (s) => { if (current === sess) sess.ui.setState({ connection: s }); };
    hub.on("Status", (st) => {
      if (current !== sess) return;
      sess.ui.setState({ live: !!st.active, languages: st.languages || sess.ui.state.languages, listeners: st.listeners || {} });
      if (!st.active) { sess.player.stop(); }
    });
    hub.on("SegmentStart", (m) => { if (current === sess && m.lang === sess.selected) sess.player.start(m); });
    hub.on("SegmentChunk", (m) => { if (current === sess) sess.player.chunk(m.seq, m.data); });
    hub.on("SegmentEnd", (m) => { if (current === sess) sess.player.end(m.seq, !!m.error); });
    hub.on("SegmentDropped", (m) => { if (current === sess) sess.player.dropped(m.seq); });
    try {
      await hub.connect();
      const st = await hub.invoke("Join", sess.login, lang);
      if (current !== sess) return;
      sess.ui.setState({ live: !!(st && st.active), listeners: (st && st.listeners) || {}, connection: "connected" });
      // Al reconectar el WS hay que volver a unirse al grupo.
      const rejoin = (s) => { if (s === "connected" && current === sess) hub.invoke("Join", sess.login, sess.selected).catch(() => {}); };
      const prev = hub.onstate; hub.onstate = (s) => { prev(s); rejoin(s); };
      sess.ui.onopen = async () => {
        if (current !== sess || hub.state !== "connected") return;
        try { const st2 = await hub.invoke("Join", sess.login, sess.selected); if (st2 && current === sess) sess.ui.setState({ live: !!st2.active, listeners: st2.listeners || {} }); } catch {}
      };
    } catch (e) {
      console.warn("[decatron] hub", e);
      if (current === sess) sess.ui.setState({ connection: "error" });
    }
  }

  function leave() {
    if (!current) return;
    current.ui.setAudioBlocked(false);
    if (current.hub) { try { current.hub.send("Leave"); } catch {} current.hub.close(); current.hub = null; }
    current.player.stop();
    current.selected = null;
    current.ui.setState({ selected: null, connection: "idle" });
  }

  // ───────────── idioma recordado por canal (local, no sync: es por sesión de PC)
  function getChannelLang(login) {
    return new Promise((resolve) => {
      try { chrome.storage.local.get(["channels"], (v) => resolve(((v && v.channels) || {})[login])); } catch { resolve(undefined); }
    });
  }
  function setChannelLang(login, lang) {
    try {
      chrome.storage.local.get(["channels"], (v) => {
        const ch = (v && v.channels) || {};
        ch[login] = lang;   // null = eligió "Original" explícitamente
        chrome.storage.local.set({ channels: ch });
      });
    } catch {}
  }

  function setBadge(login, info) {
    try { chrome.runtime.sendMessage({ type: "channel", login, enabled: !!(info && info.enabled), live: !!(info && info.live), languages: (info && info.languages) || [] }); } catch {}
  }

  // El popup pregunta el estado de la pestaña.
  try {
    chrome.runtime.onMessage.addListener((msg, _s, reply) => {
      if (msg && msg.type === "state") {
        reply(current ? { login: current.login, enabled: true, live: current.ui.state.live, languages: current.ui.state.languages, selected: current.selected, connection: current.ui.state.connection } : { login: channelFromPath(), enabled: false });
        return true;
      }
      if (msg && msg.type === "select" && current) { select(msg.lang, true); reply({ ok: true }); return true; }
    });
  } catch {}

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ───────────── navegación SPA de Twitch
  async function onRoute() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const login = channelFromPath();
    if (!login) { unmount(); setBadge(null, null); return; }
    if (current && current.login === login) return;
    unmount();
    mount(login);
  }

  (async () => {
    await loadPrefs();
    onRoute();
    // Twitch navega con pushState y el content script vive en un mundo aislado (no
    // puede interceptar el history de la página), así que se vigila la URL.
    window.addEventListener("popstate", () => setTimeout(onRoute, 0));
    setInterval(onRoute, 1500);
  })();
})();
