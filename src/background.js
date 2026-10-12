// Service worker: badge del icono según lo que reporta la pestaña activa, fetch al backend (CORS) y diccionarios de emotes.
// En Firefox este archivo corre como "background script" y emote-dict.js viene antes en el manifest.
try { importScripts("emote-dict.js", "lurk.js"); } catch { /* Firefox: ya están cargados por el manifest */ }

const stateByTab = new Map();
const API = "https://decatron.net";
const ID_TTL = 30 * 24 * 3600 * 1000;

// Caché de capas del diccionario en chrome.storage.local (sobrevive al reinicio del service worker)
const cache = {
  async get(k) { const key = "dct:" + k; const v = await chrome.storage.local.get(key); return v[key]; },
  async set(k, v) { await chrome.storage.local.set({ ["dct:" + k]: v }); },
};
const freshCache = { get: async () => undefined, set: cache.set };

/** El id de Twitch de un canal casi nunca cambia: se guarda un mes */
async function channelId(login) {
  const hit = await cache.get("id:" + login);
  if (hit && Date.now() - hit.at < ID_TTL) return hit.id;
  const id = await DctEmoteDict.resolveChannelId((u, i) => fetch(u, i), login);
  if (id) await cache.set("id:" + login, { at: Date.now(), id });
  return id;
}

async function getEmotes(msg) {
  const login = String(msg.login || "").toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/.test(login)) return { ok: false, error: "login" };
  const providers = { own: !!msg.providers?.own, decatronGlobal: !!msg.providers?.decatronGlobal, sevenTv: !!msg.providers?.sevenTv, bttv: !!msg.providers?.bttv, ffz: !!msg.providers?.ffz, globals: !!msg.providers?.globals };
  const res = await DctEmoteDict.buildDictionary({ login, providers, fetch: (u, i) => fetch(u, i), cache: msg.fresh ? freshCache : cache, channelId });
  // Todo falló y no hay nada que mostrar: se avisa como error para que se reintente al cambiar de canal
  if (res.entries.length === 0 && Object.keys(res.errors).length > 0) return { ok: false, error: "providers", errors: res.errors };
  return { ok: true, entries: res.entries, channelId: res.channelId, errors: res.errors };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === "fetchPublic") {
    fetch(`${API}/api/live-translation/public/${encodeURIComponent(msg.login)}`, { cache: "no-store" })
      .then(async (r) => reply({ ok: r.ok, data: r.ok ? await r.json() : null }))
      .catch(() => reply({ ok: false }));
    return true; // respuesta asíncrona
  }
  if (msg.type === "getEmotes") {
    getEmotes(msg).then(reply).catch((e) => reply({ ok: false, error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === "multiviewAdd") { multiviewAdd(msg.login).then(reply).catch(() => reply({ ok: false, mode: "error" })); return true; }
  // Modo lurk: la página de /multi informa sus canales y cambia ajustes; las pestañas de lurk avisan que siguen vivas
  if (msg.type === "lurkSync" && sender.tab) { DctLurk.sync(sender.tab.id, msg.channels).then(() => reply({ ok: true })).catch(() => reply({ ok: false })); return true; }
  if (msg.type === "lurkSet") { DctLurk.setSettings(msg.patch || {}).then(() => reply({ ok: true })).catch(() => reply({ ok: false })); return true; }
  if (msg.type === "lurkPing") { DctLurk.tick(); return; }
  if (msg.type === "multiviewOpen") { multiviewOpen().then(reply).catch(() => reply({ ok: false })); return true; }
  if (msg.type === "channel" && sender.tab) {
    stateByTab.set(sender.tab.id, msg);
    paint(sender.tab.id, msg);
  }
});

// ───────────── Multi-view (decatron.net/multi)
const MV = "https://decatron.net/multi";
const MV_URLS = [MV, MV + "/*"];

async function focusTab(tab) {
  try { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); } catch { /* la ventana ya no existe */ }
}

/** Suma un canal de Twitch a un Multi-view abierto (sin recargarlo, si su página contesta) o abre uno nuevo con ese canal. */
async function multiviewAdd(login) {
  login = String(login || "").toLowerCase();
  if (!/^[a-z0-9_]{2,40}$/.test(login)) return { ok: false, mode: "error" };
  const [tab] = await chrome.tabs.query({ url: MV_URLS });
  if (!tab) {
    await chrome.tabs.create({ url: `${MV}/${encodeURIComponent(login)}` });
    return { ok: true, mode: "opened" };
  }
  // 1) La página del Multi-view lo agrega sola (los videos no se cortan)
  const answer = await new Promise((resolve) => {
    try { chrome.tabs.sendMessage(tab.id, { type: "mvAdd", channel: login }, (r) => resolve(chrome.runtime.lastError ? null : r)); }
    catch { resolve(null); }
  });
  if (answer && answer.mode) { if (answer.mode !== "error") await focusTab(tab); return { ok: answer.mode !== "error", ...answer }; }

  // 2) Respaldo (la pestaña se abrió antes de instalar la extensión o la página no contestó): se cambia la dirección
  const url = new URL(tab.url);
  const segs = url.pathname.split("/").filter(Boolean).slice(1);
  if (segs.some((x) => x.toLowerCase() === login)) { await focusTab(tab); return { ok: true, mode: "already", count: segs.length }; }
  url.pathname = "/multi/" + [...segs, login].map(encodeURIComponent).join("/");
  await chrome.tabs.update(tab.id, { url: url.toString(), active: true });
  await focusTab(tab);
  return { ok: true, mode: "added", count: segs.length + 1 };
}

async function multiviewOpen() {
  const [tab] = await chrome.tabs.query({ url: MV_URLS });
  if (tab) await focusTab(tab); else await chrome.tabs.create({ url: MV });
  return { ok: true };
}

chrome.tabs.onRemoved.addListener((id) => stateByTab.delete(id));

function paint(tabId, s) {
  const text = s && s.enabled ? (s.live ? "ON" : "•") : "";
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: s && s.live ? "#22c55e" : "#9146ff" });
  chrome.action.setTitle({ tabId, title: s && s.enabled ? `Decatron — ${s.login} ofrece ${s.languages.join(", ").toUpperCase()}` : "Decatron" });
}
