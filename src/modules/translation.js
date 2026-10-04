// Módulo de traducción: detecta si el canal ofrece traducción, se une al hub y reproduce el doblaje con subtítulos.
(function () {
  const D = window.__decatron;
  const { t, h, kit } = D;

  const API = "https://decatron.net";
  const HUB = "wss://decatron.net/hubs/translation";
  const LANG_NAMES = { en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", it: "Italiano", ja: "日本語", ko: "한국어", ru: "Русский" };
  const langName = (c) => LANG_NAMES[c] || c.toUpperCase();

  const GLOBE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5.9 7h-2.6a12.8 12.8 0 0 0-1.1-4.3A6 6 0 0 1 15.9 9ZM10 4c.9 1.1 1.6 2.9 1.8 5H8.2C8.4 6.9 9.1 5.1 10 4ZM4.1 11h2.6c.1 1.6.5 3 1.1 4.3A6 6 0 0 1 4.1 11Zm2.6-2H4.1a6 6 0 0 1 3.7-4.3C7.2 6 6.8 7.4 6.7 9ZM10 16c-.9-1.1-1.6-2.9-1.8-5h3.6c-.2 2.1-.9 3.9-1.8 5Zm2.2-.7c.6-1.3 1-2.7 1.1-4.3h2.6a6 6 0 0 1-3.7 4.3Z"/></svg>`;

  function findPlayer() {
    const video = document.querySelector(".video-player video, video[playsinline]");
    const root = video && (video.closest(".video-player__container") || video.closest(".video-player") || video.parentElement);
    if (!video || !root) return null;
    return { video, root };
  }

  const mod = {
    id: "translation",
    order: 1,
    icon: GLOBE,
    defaults: { enabled: true },
    name: () => t("tr.name"),
    description: () => t("tr.desc"),

    /** Lo que ve el panel: si el canal ofrece traducción y cómo va */
    state: { available: false, live: false, languages: [], listeners: {}, selected: null, connection: "idle" },
    current: null,

    setState(patch) { Object.assign(mod.state, patch); D.emit("module-update", "translation"); },

    status() {
      const s = mod.state;
      if (!s.available) return null;
      return {
        active: !!s.selected,
        live: s.live,
        text: s.selected ? t("tr.listening", { lang: langName(s.selected) }) : (s.live ? t("tr.statusLive") : t("tr.statusWait")),
      };
    },

    start() {},
    stop() { unmount(); mod.state = { available: false, live: false, languages: [], listeners: {}, selected: null, connection: "idle" }; },

    onChannel(login) {
      unmount();
      mod.state = { available: false, live: false, languages: [], listeners: {}, selected: null, connection: "idle" };
      D.emit("module-update", "translation");
      if (login) mount(login);
    },

    // ───────────── panel
    renderPanel(body) {
      const listBox = h("div", { class: "sec" });
      const prefsBox = h("div", { class: "sec" });
      body.append(listBox, prefsBox);

      const renderList = () => {
        const s = mod.state;
        listBox.textContent = "";
        if (!D.channel) { listBox.append(kit.notice(t("tr.noChannel"))); return; }
        if (!s.available) {
          listBox.append(kit.notice(t("tr.unavailable")), h("p", { class: "foot-link" }, h("a", { href: "https://decatron.net/translate", target: "_blank", rel: "noreferrer" }, t("tr.streamer"))));
          return;
        }
        let sub = t("tr.onlyYou");
        if (!s.live) sub = t("tr.notLive");
        else if (s.connection === "connecting" || s.connection === "reconnecting") sub = t("tr.connecting");
        listBox.append(h("h3", null, t("tr.listenIn")), kit.notice(sub, s.live ? "ok" : ""));
        const chips = h("div", { class: "chips", style: "margin-top:12px" });
        const add = (lang, label, n) => chips.append(h("button", {
          class: "lang" + (s.selected === lang ? " on" : ""), onclick: () => select(lang, true),
        }, label, n ? h("small", null, n === 1 ? t("tr.listener1") : t("tr.listeners", { n })) : null));
        add(null, t("tr.original"), 0);
        for (const lang of s.languages) add(lang, langName(lang), s.listeners[lang] || 0);
        listBox.append(chips);
      };

      prefsBox.append(
        kit.section(null,
          kit.toggleRow(t("tr.autoJoin"), null, D.prefs.autoJoin, (v) => D.setPrefs({ autoJoin: v })),
          kit.row(t("tr.preferred"), null, kit.select(D.prefs.preferredLang || "", [["", t("tr.none")], ...Object.entries(LANG_NAMES)], (v) => D.setPrefs({ preferredLang: v || null }))),
          kit.slider(t("tr.bgVolume"), Math.round(D.prefs.backgroundVolume * 100), 0, 60, 1, "%", (v) => D.setPrefs({ backgroundVolume: v / 100 })),
          kit.slider(t("tr.delay"), D.prefs.delaySec, 0, 8, 0.5, " s", (v) => D.setPrefs({ delaySec: v })),
          kit.toggleRow(t("tr.captions"), null, D.prefs.captions, (v) => D.setPrefs({ captions: v })),
          kit.toggleRow(t("tr.captionSource"), null, D.prefs.captionSource, (v) => D.setPrefs({ captionSource: v })),
          kit.slider(t("tr.captionSize"), D.prefs.captionSize, 14, 36, 1, "px", (v) => D.setPrefs({ captionSize: v }))));

      renderList();
      const off = D.on("module-update", (id) => { if (id === "translation") renderList(); });
      return off;
    },
  };

  // ───────────── ciclo de vida por canal
  async function mount(login) {
    const r = await D.sw({ type: "fetchPublic", login });
    const info = r && r.ok ? r.data : null;
    if (D.channel !== login) return;               // ya se fue a otro canal
    if (!info || !info.enabled) { setBadge(login, null); return; }

    mod.setState({ available: true, live: !!info.live, languages: info.languages || [], listeners: {} });
    setBadge(login, info);

    // El player puede tardar en montarse tras navegar; reintentar un rato.
    let p = null;
    for (let i = 0; i < 40 && !p; i++) { p = findPlayer(); if (!p) await D.sleep(250); if (D.channel !== login) return; }
    if (!p) { console.warn("[decatron] no encontré el player de Twitch (video)"); return; }
    if (mod.current && mod.current.login === login) return;

    const ui = new window.__decatronCaptionsUi(p.root, D.prefs);
    ui.rootProvider = () => { const q = findPlayer(); return q ? q.root : null; };
    const player = new window.__decatronPlayer(p.video);
    player.backgroundVolume = D.prefs.backgroundVolume;
    player.delaySec = D.prefs.delaySec;
    player.onsegment = (meta, dur) => ui.showCaption(meta, dur);
    player.onaudioblocked = (b, reason) => ui.setAudioBlocked(b, reason);
    ui.onunlock = () => player.unlock();
    p.video.addEventListener("volumechange", () => player.noteUserVolume());

    const cur = { login, ui, player, hub: null, info, pollTimer: null, video: p.video };
    mod.current = cur;

    // Si el espectador ya eligió idioma en este canal (o tiene uno preferido), unirse solo.
    const remembered = await getChannelLang(login);
    const want = remembered !== undefined ? remembered : (D.prefs.autoJoin ? D.prefs.preferredLang : null);
    if (mod.current === cur && want && (info.languages || []).includes(want)) select(want, false);

    // Estado del canal cada 30 s mientras no estemos en el hub (para ver cuándo se enciende).
    cur.pollTimer = setInterval(async () => {
      if (mod.current !== cur || cur.hub) return;
      const rr = await D.sw({ type: "fetchPublic", login });
      const i2 = rr && rr.ok ? rr.data : null;
      if (i2 && mod.current === cur) { cur.info = i2; mod.setState({ live: !!i2.live, languages: i2.languages || [] }); }
    }, 30000);

    // Twitch re-renderiza el player (teatro, pantalla completa): subtítulos y video tienen que seguir al nuevo
    cur.observer = new MutationObserver(() => {
      if (mod.current !== cur) return;
      const p2 = findPlayer();
      if (!p2) return;
      cur.ui.ensureMounted();
      if (p2.video !== cur.player.video) { cur.player.video = p2.video; p2.video.addEventListener("volumechange", () => mod.current === cur && cur.player.noteUserVolume()); }
    });
    cur.observer.observe(document.body, { childList: true, subtree: true });
  }

  function unmount() {
    const cur = mod.current;
    if (!cur) return;
    leave();
    if (cur.pollTimer) clearInterval(cur.pollTimer);
    if (cur.observer) cur.observer.disconnect();
    cur.ui.destroy();
    cur.player.destroy();
    mod.current = null;
  }

  async function select(lang, byUser) {
    const cur = mod.current;
    if (!cur) return;
    if (byUser) { setChannelLang(cur.login, lang); if (lang) D.setPrefs({ preferredLang: lang }); }
    if (!lang) { leave(); return; }
    if (mod.state.selected === lang && cur.hub) return;
    cur.ui.selected = lang;
    mod.setState({ selected: lang, connection: "connecting" });
    // El clic del usuario habilita el audio; sin gesto Chrome bloquea el AudioContext y
    // ensureContext lo reporta para mostrar el aviso de "Activar audio".
    await cur.player.ensureContext();
    await joinHub(cur, lang);
  }

  async function joinHub(cur, lang) {
    if (cur.hub) { cur.hub.close(); cur.hub = null; }
    const hub = new window.__decatronSignalR(HUB);
    cur.hub = hub;
    hub.onstate = (s) => { if (mod.current === cur) mod.setState({ connection: s }); };
    hub.on("Status", (st) => {
      if (mod.current !== cur) return;
      mod.setState({ live: !!st.active, languages: st.languages || mod.state.languages, listeners: st.listeners || {} });
      if (!st.active) cur.player.stop();
    });
    hub.on("SegmentStart", (m) => { if (mod.current === cur && m.lang === mod.state.selected) cur.player.start(m); });
    hub.on("SegmentChunk", (m) => { if (mod.current === cur) cur.player.chunk(m.seq, m.data); });
    hub.on("SegmentEnd", (m) => { if (mod.current === cur) cur.player.end(m.seq, !!m.error); });
    hub.on("SegmentDropped", (m) => { if (mod.current === cur) cur.player.dropped(m.seq); });
    try {
      await hub.connect();
      const st = await hub.invoke("Join", cur.login, lang);
      if (mod.current !== cur) return;
      mod.setState({ live: !!(st && st.active), listeners: (st && st.listeners) || {}, connection: "connected" });
      // Al reconectar el WS hay que volver a unirse al grupo.
      const rejoin = (s) => { if (s === "connected" && mod.current === cur) hub.invoke("Join", cur.login, mod.state.selected).catch(() => {}); };
      const prev = hub.onstate; hub.onstate = (s) => { prev(s); rejoin(s); };
    } catch (e) {
      console.warn("[decatron] hub", e);
      if (mod.current === cur) mod.setState({ connection: "error" });
    }
  }

  function leave() {
    const cur = mod.current;
    if (!cur) return;
    cur.ui.selected = null;
    cur.ui.setAudioBlocked(false);
    if (cur.hub) { try { cur.hub.send("Leave"); } catch { /* ya cerrado */ } cur.hub.close(); cur.hub = null; }
    cur.player.stop();
    mod.setState({ selected: null, connection: "idle" });
  }

  // Cambios en las preferencias (desde el panel o el popup) llegan al audio y a los subtítulos
  D.on("prefs", () => {
    const cur = mod.current;
    if (!cur) return;
    cur.player.backgroundVolume = D.prefs.backgroundVolume;
    cur.player.delaySec = D.prefs.delaySec;
    cur.ui.prefs = D.prefs;
    cur.ui.applyCaptionPrefs();
    if (!D.prefs.captions) cur.ui.showCaption(null, 0);
  });

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
    } catch { /* sin storage */ }
  }

  function setBadge(login, info) {
    D.sw({ type: "channel", login, enabled: !!(info && info.enabled), live: !!(info && info.live), languages: (info && info.languages) || [] });
  }

  D.register(mod);
})();
