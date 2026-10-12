// Modo lurk (service worker). El player embebido de decatron.net/multi NO suma puntos de canal ni rachas en Twitch; una pestaña
// normal de twitch.tv sí, aunque esté silenciada y en segundo plano. Por cada canal de Twitch abierto en un /multi, según lo que
// elija quien mira, se abre una pestaña real de Twitch silenciada, en calidad mínima y en una ventana aparte:
//   streak → una vez por directo, unos minutos, y se cierra sola (la racha cuenta una vez por transmisión)
//   full   → abierta mientras el canal esté en vivo y en algún /multi (puntos pasivos, cofres con el módulo de puntos y racha)
// Apagado por defecto (modules.lurk.enabled). Cada canal puede tener su propio ajuste (modules.lurk.channels[login]).
// Si la persona cierra una de estas pestañas, no se vuelve a abrir en ese directo. Al cerrar el último /multi se cierran todas.
// No hay temporizadores largos (el service worker se duerme): todo se recalcula en tick(), que llaman los avisos periódicos de
// la página de /multi y de las propias pestañas de lurk, y los cambios de ajustes o de pestañas.
const DctLurk = (() => {
  const MV_URLS = ["https://decatron.net/multi", "https://decatron.net/multi/*"];
  const MARK = "dct-lurk";
  const STREAK_MS = 10 * 60 * 1000;   // sin aviso propio de Twitch, la pestaña de racha se cierra a los 10 minutos
  const STREAK_PARALLEL = 3;          // pestañas de racha abiertas a la vez; el resto espera turno
  const LIVE_TTL = 60 * 1000;
  const DONE_TTL = 3 * 24 * 3600 * 1000;
  const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // el id público que usa la web de Twitch (como en emote-dict.js)
  const LOGIN = /^[a-z0-9_]{2,40}$/;
  const store = chrome.storage.session || chrome.storage.local;
  const closingByUs = new Set();

  async function settings() {
    const v = await chrome.storage.sync.get({ modules: {} });
    const s = (v.modules && v.modules.lurk) || {};
    return {
      enabled: s.enabled === true,
      mode: s.mode === "full" ? "full" : "streak",
      channels: s.channels && typeof s.channels === "object" ? s.channels : {},
    };
  }

  async function setSettings(patch) {
    const v = await chrome.storage.sync.get({ modules: {} });
    const cur = (v.modules && v.modules.lurk) || {};
    const next = { ...cur };
    if (typeof patch.enabled === "boolean") next.enabled = patch.enabled;
    if (patch.mode === "streak" || patch.mode === "full") next.mode = patch.mode;
    if (patch.login && LOGIN.test(patch.login)) {
      const ch = { ...(cur.channels || {}) };
      if (["off", "streak", "full"].includes(patch.channelMode)) ch[patch.login] = patch.channelMode; else delete ch[patch.login];
      next.channels = ch;
    }
    await chrome.storage.sync.set({ modules: { ...v.modules, lurk: next } });
  }

  /** login → id del directo en curso, null si no está en vivo. Los que no se pudieron consultar no aparecen. */
  async function liveInfo(logins) {
    const { lurkLive } = await store.get("lurkLive");
    const cache = lurkLive && Date.now() - lurkLive.at < LIVE_TTL ? lurkLive.map : {};
    const missing = logins.filter((l) => !(l in cache));
    if (!missing.length) return cache;
    const map = { ...cache };
    try {
      const res = await fetch("https://gql.twitch.tv/gql", {
        method: "POST",
        headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
        body: JSON.stringify({ query: "query($logins:[String!]){users(logins:$logins){login stream{id}}}", variables: { logins: logins.slice(0, 30) } }),
      });
      if (!res.ok) return cache;
      const j = await res.json();
      const users = (j && j.data && j.data.users) || [];
      for (const l of logins) map[l] = null;
      for (const u of users) if (u && u.login) map[u.login.toLowerCase()] = (u.stream && u.stream.id) || null;
      await store.set({ lurkLive: { at: Date.now(), map } });
      return map;
    } catch { return cache; }
  }

  async function exists(tabId) { try { await chrome.tabs.get(tabId); return true; } catch { return false; } }

  async function openTab(login, st) {
    const url = `https://www.twitch.tv/${encodeURIComponent(login)}?${MARK}=1`;
    let tab = null;
    if (st.lurkWindow != null) {
      try { await chrome.windows.get(st.lurkWindow); tab = await chrome.tabs.create({ windowId: st.lurkWindow, url, active: false }); }
      catch { st.lurkWindow = null; }
    }
    if (!tab) {
      // Ventana aparte y minimizada: no llena la ventana de la persona de pestañas
      let win = null;
      try { win = await chrome.windows.create({ url, focused: false, state: "minimized" }); }
      catch { win = await chrome.windows.create({ url, focused: false }); }
      st.lurkWindow = win.id;
      tab = win.tabs && win.tabs[0] ? win.tabs[0] : (await chrome.tabs.query({ windowId: win.id }))[0];
    }
    if (!tab) return null;
    try { await chrome.tabs.update(tab.id, { muted: true }); } catch { /* el navegador no deja silenciar */ }
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch { /* sin soporte (Firefox) */ }
    return tab.id;
  }

  async function closeTab(tabId) {
    closingByUs.add(tabId);
    try { await chrome.tabs.remove(tabId); } catch { /* ya no existe */ }
    setTimeout(() => closingByUs.delete(tabId), 5000);
  }

  async function run() {
    const cfg = await settings();
    const st = { lurkTabs: {}, lurkWindow: null, mvChannels: {}, ...(await store.get(["lurkTabs", "lurkWindow", "mvChannels"])) };
    const { lurkDone: doneRaw } = await chrome.storage.local.get("lurkDone");
    const done = {};
    const now = Date.now();
    for (const [l, d] of Object.entries(doneRaw || {})) if (d && now - d.at < DONE_TTL) done[l] = d;

    // Los /multi que siguen abiertos y sus canales
    const mvTabs = await chrome.tabs.query({ url: MV_URLS });
    const mvIds = new Set(mvTabs.map((t) => String(t.id)));
    for (const id of Object.keys(st.mvChannels)) if (!mvIds.has(id)) delete st.mvChannels[id];
    for (const id of Object.keys(st.lurkTabs)) if (!(await exists(Number(id)))) delete st.lurkTabs[id];

    const wanted = [...new Set(Object.values(st.mvChannels).flat())].filter((l) => LOGIN.test(l));
    const effective = (l) => {
      if (!cfg.enabled) return "off";
      const m = cfg.channels[l];
      return m === "off" || m === "streak" || m === "full" ? m : cfg.mode;
    };
    const live = wanted.length && cfg.enabled ? await liveInfo(wanted) : {};
    const byLogin = {};
    for (const [id, t] of Object.entries(st.lurkTabs)) byLogin[t.login] = { id: Number(id), ...t };

    const status = {};
    const toClose = new Set();
    const toOpen = [];
    for (const l of wanted) {
      const eff = effective(l);
      const tab = byLogin[l];
      const streamId = l in live ? live[l] : undefined;
      const d = done[l] && streamId && done[l].streamId === streamId ? done[l] : null;
      if (eff === "off") { if (tab) toClose.add(tab.id); status[l] = "off"; continue; }
      if (streamId === null) { if (tab) toClose.add(tab.id); status[l] = "offline"; continue; }
      if (streamId === undefined) { status[l] = tab ? "open" : "queued"; continue; } // sin dato de Twitch: no se toca nada
      if (d && d.how === "closed") { if (tab) toClose.add(tab.id); status[l] = "closed"; continue; }
      if (eff === "full") {
        if (tab) { st.lurkTabs[tab.id].mode = "full"; status[l] = "open"; }
        else { toOpen.push({ login: l, mode: "full", streamId }); status[l] = "queued"; }
        continue;
      }
      if (d) { if (tab) toClose.add(tab.id); status[l] = "done"; continue; }
      if (tab) {
        st.lurkTabs[tab.id].mode = "streak";
        if (now - tab.openedAt >= STREAK_MS) { toClose.add(tab.id); done[l] = { streamId, at: now, how: "timer" }; status[l] = "done"; }
        else status[l] = "open";
        continue;
      }
      toOpen.push({ login: l, mode: "streak", streamId });
      status[l] = "queued";
    }
    // Canales que ya no están en ningún /multi (o no queda ningún /multi abierto)
    for (const t of Object.values(byLogin)) if (!wanted.includes(t.login)) toClose.add(t.id);

    for (const id of toClose) { delete st.lurkTabs[id]; await closeTab(id); }
    let streakOpen = Object.values(st.lurkTabs).filter((t) => t.mode === "streak").length;
    for (const o of toOpen) {
      if (o.mode === "streak" && streakOpen >= STREAK_PARALLEL) continue;
      const id = await openTab(o.login, st).catch(() => null);
      if (id == null) continue;
      st.lurkTabs[id] = { login: o.login, mode: o.mode, streamId: o.streamId, openedAt: Date.now() };
      status[o.login] = "open";
      if (o.mode === "streak") streakOpen++;
    }
    if (!Object.keys(st.lurkTabs).length) st.lurkWindow = null;

    await store.set({ lurkTabs: st.lurkTabs, lurkWindow: st.lurkWindow, mvChannels: st.mvChannels });
    await chrome.storage.local.set({ lurkDone: done });

    // Cada /multi ve el estado de sus canales
    const openedAt = {};
    for (const t of Object.values(st.lurkTabs)) openedAt[t.login] = t.openedAt;
    for (const t of mvTabs) {
      const channels = {};
      for (const l of st.mvChannels[String(t.id)] || []) {
        channels[l] = { mode: cfg.channels[l] || "default", effective: effective(l), status: status[l] || "queued", openedAt: openedAt[l] };
      }
      try { chrome.tabs.sendMessage(t.id, { type: "lurkState", state: { enabled: cfg.enabled, mode: cfg.mode, channels } }, () => void chrome.runtime.lastError); }
      catch { /* la página se cerró */ }
    }
  }

  // Una sola vuelta a la vez; si llegan avisos mientras corre, se repite una vez al terminar
  let running = null, again = false;
  function tick() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; try { await run(); } catch (e) { console.warn("[decatron] lurk", e); } } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  async function sync(tabId, channels) {
    const { mvChannels } = await store.get("mvChannels");
    const list = (Array.isArray(channels) ? channels : []).map((c) => String(c).toLowerCase()).filter((c) => LOGIN.test(c)).slice(0, 30);
    await store.set({ mvChannels: { ...(mvChannels || {}), [String(tabId)]: list } });
    return tick();
  }

  // La persona cerró una pestaña de lurk (o toda su ventana): no se vuelve a abrir en ese directo
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    if (closingByUs.has(tabId)) return;
    const { lurkTabs } = await store.get("lurkTabs");
    const t = lurkTabs && lurkTabs[tabId];
    if (t) {
      const { lurkDone } = await chrome.storage.local.get("lurkDone");
      await chrome.storage.local.set({ lurkDone: { ...(lurkDone || {}), [t.login]: { streamId: t.streamId, at: Date.now(), how: "closed" } } });
      delete lurkTabs[tabId];
      await store.set({ lurkTabs });
    }
    tick();
  });

  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && changes.modules) tick(); });

  return { tick, sync, setSettings };
})();
