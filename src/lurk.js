// Modo lurk (service worker). El player embebido de decatron.net/multi NO suma puntos de canal ni rachas en Twitch; una pestaña
// normal de twitch.tv sí, aunque esté silenciada y en segundo plano. Por cada canal de Twitch abierto en un /multi, según lo que
// elija quien mira, se abre una pestaña real de Twitch silenciada, en calidad mínima y en una ventana aparte:
//   streak → una vez por directo, hasta que la racha sube (lurk-tab.js la lee del menú de puntos) o 30 minutos como tope
//   full   → abierta mientras el canal esté en vivo y en algún /multi (puntos pasivos, cofres con el módulo de puntos y racha)
// Apagado por defecto (modules.lurk.enabled). Cada canal puede tener su propio ajuste (modules.lurk.channels[login]).
// Si la persona cierra una de estas pestañas, no se vuelve a abrir en ese directo. Al cerrar el último /multi se cierran todas.
// No hay temporizadores largos (el service worker se duerme): todo se recalcula en tick(), que llaman los avisos periódicos de
// la página de /multi y de las propias pestañas de lurk, y los cambios de ajustes o de pestañas.
const DctLurk = (() => {
  const MV_URLS = ["https://decatron.net/multi", "https://decatron.net/multi/*"];
  const MARK = "dct-lurk";
  const STREAK_MS = 30 * 60 * 1000;   // tope de la pestaña de racha si no se ve subir la racha (lo normal es cerrarse antes, al subir)
  const LOG_MAX = 80;
  const STREAK_PARALLEL = 3;          // pestañas de racha abiertas a la vez; el resto espera turno
  const LIVE_TTL = 60 * 1000;
  const DONE_TTL = 3 * 24 * 3600 * 1000;
  const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // el id público que usa la web de Twitch (como en emote-dict.js)
  const LOGIN = /^[a-z0-9_]{2,40}$/;
  const store = chrome.storage.session || chrome.storage.local;
  const closingByUs = new Set();

  // Historial del lurk (lo ve la persona en /multi): qué se abrió, si el video avanza, la racha leída y por qué se cerró
  async function log(login, code, p) {
    const { lurkLog } = await chrome.storage.local.get("lurkLog");
    const list = Array.isArray(lurkLog) ? lurkLog : [];
    list.push({ at: Date.now(), login, code, p: p || {} });
    await chrome.storage.local.set({ lurkLog: list.slice(-LOG_MAX) });
  }

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
    const real = `https://www.twitch.tv/${encodeURIComponent(login)}?${MARK}=1`;
    // En la prueba de punta a punta (dctLurkTest) la pestaña nace en blanco y luego carga la dirección: así el navegador de pruebas
    // alcanza a servir su réplica de Twitch en lugar de la página real
    const { dctLurkTest } = await chrome.storage.local.get("dctLurkTest");
    const url = dctLurkTest ? "about:blank" : real;
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
    if (dctLurkTest) { await new Promise((r) => setTimeout(r, 400)); await chrome.tabs.update(tab.id, { url: real }); }
    try { await chrome.tabs.update(tab.id, { muted: true }); } catch { /* el navegador no deja silenciar */ }
    try { await chrome.tabs.update(tab.id, { autoDiscardable: false }); } catch { /* sin soporte (Firefox) */ }
    return tab.id;
  }

  async function closeTab(tabId, login, why, p) {
    if (login) await log(login, "closed_" + why, p);
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
    const toClose = new Map(); // id → [login, motivo]
    const toOpen = [];
    for (const l of wanted) {
      const eff = effective(l);
      const tab = byLogin[l];
      const streamId = l in live ? live[l] : undefined;
      const d = done[l] && streamId && done[l].streamId === streamId ? done[l] : null;
      if (eff === "off") { if (tab) toClose.set(tab.id, [l, "off"]); status[l] = "off"; continue; }
      if (streamId === null) { if (tab) toClose.set(tab.id, [l, "offline"]); status[l] = "offline"; continue; }
      if (streamId === undefined) { status[l] = tab ? "open" : "queued"; continue; } // sin dato de Twitch: no se toca nada
      if (d && d.how === "closed") { if (tab) toClose.set(tab.id, [l, "user"]); status[l] = "closed"; continue; }
      if (eff === "full") {
        if (tab) { st.lurkTabs[tab.id].mode = "full"; status[l] = "open"; }
        else { toOpen.push({ login: l, mode: "full", streamId }); status[l] = "queued"; }
        continue;
      }
      if (d) { if (tab) toClose.set(tab.id, [l, d.how === "earned" ? "earned" : "timeout"]); status[l] = d.how === "earned" ? "done" : "timeout"; continue; }
      if (tab) {
        st.lurkTabs[tab.id].mode = "streak";
        if (now - tab.openedAt >= STREAK_MS) { toClose.set(tab.id, [l, "timeout"]); done[l] = { streamId, at: now, how: "timer" }; status[l] = "timeout"; }
        else status[l] = "open";
        continue;
      }
      toOpen.push({ login: l, mode: "streak", streamId });
      status[l] = "queued";
    }
    // Canales que ya no están en ningún /multi (o no queda ningún /multi abierto)
    for (const t of Object.values(byLogin)) if (!wanted.includes(t.login)) toClose.set(t.id, [t.login, "removed"]);

    for (const [id, [l, why]] of toClose) {
      const t = st.lurkTabs[id];
      delete st.lurkTabs[id];
      await closeTab(id, l, why, { minutes: t ? Math.round((now - t.openedAt) / 60000) : 0, streak: t && t.streak ? t.streak.last : null });
    }
    let streakOpen = Object.values(st.lurkTabs).filter((t) => t.mode === "streak").length;
    for (const o of toOpen) {
      if (o.mode === "streak" && streakOpen >= STREAK_PARALLEL) continue;
      const id = await openTab(o.login, st).catch(() => null);
      if (id == null) continue;
      st.lurkTabs[id] = { login: o.login, mode: o.mode, streamId: o.streamId, openedAt: Date.now() };
      await log(o.login, "opened", { mode: o.mode });
      status[o.login] = "open";
      if (o.mode === "streak") streakOpen++;
    }
    if (!Object.keys(st.lurkTabs).length) st.lurkWindow = null;

    await store.set({ lurkTabs: st.lurkTabs, lurkWindow: st.lurkWindow, mvChannels: st.mvChannels });
    await chrome.storage.local.set({ lurkDone: done });

    // Cada /multi ve el estado de sus canales
    const openedAt = {}, streak = {}, health = {};
    for (const t of Object.values(st.lurkTabs)) { openedAt[t.login] = t.openedAt; streak[t.login] = t.streak ? t.streak.last : null; health[t.login] = t.noSession ? "nosession" : t.health || null; }
    const { lurkLog } = await chrome.storage.local.get("lurkLog");
    const recent = (Array.isArray(lurkLog) ? lurkLog : []).slice(-40);
    for (const t of mvTabs) {
      const channels = {};
      for (const l of st.mvChannels[String(t.id)] || []) {
        channels[l] = { mode: cfg.channels[l] || "default", effective: effective(l), status: status[l] || "queued", openedAt: openedAt[l], streak: streak[l] || null, health: health[l] };
      }
      try { chrome.tabs.sendMessage(t.id, { type: "lurkState", state: { enabled: cfg.enabled, mode: cfg.mode, channels, log: recent, maxMinutes: STREAK_MS / 60000 } }, () => void chrome.runtime.lastError); }
      catch { /* la página se cerró */ }
    }
  }

  // Todo lo que lee y escribe el estado va en fila, de a uno (si no, un aviso de la pestaña se pisaría con una vuelta de run()).
  // Varias vueltas pedidas mientras una espera turno se juntan en una sola.
  let chain = Promise.resolve();
  let runQueued = false;
  function serial(fn) {
    const p = chain.then(fn).catch((e) => console.warn("[decatron] lurk", e));
    chain = p;
    return p;
  }
  function tick() {
    if (runQueued) return chain;
    runQueued = true;
    return serial(async () => { runQueued = false; await run(); });
  }

  async function sync(tabId, channels) {
    const list = (Array.isArray(channels) ? channels : []).map((c) => String(c).toLowerCase()).filter((c) => LOGIN.test(c)).slice(0, 30);
    await serial(async () => {
      const { mvChannels } = await store.get("mvChannels");
      await store.set({ mvChannels: { ...(mvChannels || {}), [String(tabId)]: list } });
    });
    return tick();
  }

  /** Lo que informa una pestaña de lurk (lurk-tab.js): sesión, reproducción y racha. Si la racha cambia, ya contó en este directo. */
  async function fromTab(tabId, event, data) {
    await serial(() => applyTabReport(tabId, event, data));
    return tick();
  }
  async function applyTabReport(tabId, event, data) {
    const { lurkTabs } = await store.get("lurkTabs");
    const t = lurkTabs && lurkTabs[tabId];
    if (!t) return;
    const d = data || {};
    if (event === "nosession") { t.noSession = true; await log(t.login, "nosession"); }
    else if (event === "playing") { t.health = "playing"; await log(t.login, "playing", { muted: !!d.muted, height: Number(d.height) || 0 }); }
    else if (event === "resumed") { t.health = "playing"; await log(t.login, "resumed", { muted: !!d.muted }); }
    else if (event === "paused") { t.health = "paused"; await log(t.login, "paused"); }
    else if (event === "streakUnreadable") { await log(t.login, "streak_unreadable", { reason: String(d.reason || ""), raw: String(d.raw || "").slice(0, 180) }); }
    else if (event === "streak" && Number.isFinite(d.have) && Number.isFinite(d.need)) {
      const now = { have: d.have, need: d.need };
      if (!t.streak) { t.streak = { first: now, last: now }; await log(t.login, "streak_read", { have: d.have, need: d.need, raw: String(d.raw || "").slice(0, 180) }); }
      else if (t.streak.last.have !== d.have || t.streak.last.need !== d.need) {
        t.streak.last = now;
        await log(t.login, "streak_up", { have: d.have, need: d.need, from: t.streak.first.have + "/" + t.streak.first.need });
        const { lurkDone } = await chrome.storage.local.get("lurkDone");
        await chrome.storage.local.set({ lurkDone: { ...(lurkDone || {}), [t.login]: { streamId: t.streamId, at: Date.now(), how: "earned" } } });
      }
    }
    lurkTabs[tabId] = t;
    await store.set({ lurkTabs });
  }

  // La persona cerró una pestaña de lurk (o toda su ventana): no se vuelve a abrir en ese directo
  chrome.tabs.onRemoved.addListener((tabId) => {
    if (closingByUs.has(tabId)) { tick(); return; }
    serial(() => userClosed(tabId)).then(tick);
  });
  async function userClosed(tabId) {
    const { lurkTabs } = await store.get("lurkTabs");
    const t = lurkTabs && lurkTabs[tabId];
    if (t) {
      const { lurkDone } = await chrome.storage.local.get("lurkDone");
      await chrome.storage.local.set({ lurkDone: { ...(lurkDone || {}), [t.login]: { streamId: t.streamId, at: Date.now(), how: "closed" } } });
      await log(t.login, "closed_user", { minutes: Math.round((Date.now() - t.openedAt) / 60000) });
      delete lurkTabs[tabId];
      await store.set({ lurkTabs });
    }
  }

  chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && changes.modules) tick(); });

  async function clearLog() { await serial(() => chrome.storage.local.set({ lurkLog: [] })); return tick(); }

  return { tick, sync, setSettings, fromTab, clearLog };
})();
