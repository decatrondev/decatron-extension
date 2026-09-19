// Service worker: solo mantiene el badge del icono según lo que reporta la pestaña activa.
const stateByTab = new Map();

const API = "https://decatron.net";

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg) return;
  if (msg.type === "fetchPublic") {
    fetch(`${API}/api/live-translation/public/${encodeURIComponent(msg.login)}`, { cache: "no-store" })
      .then(async (r) => reply({ ok: r.ok, data: r.ok ? await r.json() : null }))
      .catch(() => reply({ ok: false }));
    return true; // respuesta asíncrona
  }
  if (msg.type === "channel" && sender.tab) {
    stateByTab.set(sender.tab.id, msg);
    paint(sender.tab.id, msg);
  }
});

chrome.tabs.onRemoved.addListener((id) => stateByTab.delete(id));

function paint(tabId, s) {
  const text = s && s.enabled ? (s.live ? "ON" : "•") : "";
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setBadgeBackgroundColor({ tabId, color: s && s.live ? "#22c55e" : "#9146ff" });
  chrome.action.setTitle({ tabId, title: s && s.enabled ? `Decatron Translate — ${s.login} ofrece ${s.languages.join(", ").toUpperCase()}` : "Decatron Translate" });
}
