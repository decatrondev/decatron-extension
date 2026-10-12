// Popup de la barra del navegador: un resumen del canal, un interruptor por módulo y el atajo al panel dentro de Twitch.
const { t } = window.__dctI18n;
const $ = (id) => document.getElementById(id);
// Cada módulo con su valor de fábrica: el de puntos nace apagado y el resto encendido (igual que `defaults.enabled` de cada módulo).
const MODULES = [
  { id: "translation", name: () => t("tr.name"), defaultEnabled: true },
  { id: "emotes", name: () => t("em.name"), defaultEnabled: true },
  { id: "multiview", name: () => t("mv.name"), defaultEnabled: true },
  { id: "points", name: () => t("pt.name"), defaultEnabled: false },
];

$("mods-title").textContent = t("pop.modules");
$("open").textContent = t("pop.openPanel");
$("ch-title").textContent = t("pop.noTwitch");

function renderModules(enabledById) {
  const box = $("mods");
  box.textContent = "";
  for (const m of MODULES) {
    const row = document.createElement("label");
    row.className = "row" + (m.soon ? " soon" : "");
    const name = document.createElement("span");
    name.textContent = m.name();
    row.append(name);
    if (m.soon) {
      const tag = document.createElement("small");
      tag.textContent = t("panel.soon");
      row.append(tag);
    } else {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = enabledById[m.id] == null ? m.defaultEnabled : enabledById[m.id] !== false;
      input.onchange = () => {
        chrome.storage.sync.get({ modules: {} }, (v) => {
          const modules = { ...v.modules, [m.id]: { ...(v.modules[m.id] || {}), enabled: input.checked } };
          chrome.storage.sync.set({ modules });
        });
      };
      row.append(input);
    }
    box.append(row);
  }
}

chrome.storage.sync.get({ modules: {} }, (v) => {
  const enabled = {};
  for (const m of MODULES) enabled[m.id] = (v.modules[m.id] || {}).enabled;
  renderModules(enabled);
});

// Estado de la pestaña activa
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !/^https:\/\/www\.twitch\.tv\//.test(tab.url || "")) return;
  chrome.tabs.sendMessage(tab.id, { type: "state" }, (st) => {
    if (chrome.runtime.lastError || !st) return;
    $("open").hidden = false;
    $("open").onclick = () => chrome.tabs.sendMessage(tab.id, { type: "openPanel" }, () => window.close());
    $("ch-title").textContent = st.login ? st.login : t("pop.noTwitch");
    const lines = $("ch-lines");
    lines.textContent = "";
    const add = (text) => { const d = document.createElement("div"); d.className = "sub"; d.textContent = text; lines.append(d); };
    const tr = st.modules && st.modules.translation;
    if (st.login && tr && tr.enabled) add(tr.status ? tr.status.text : t("pop.translationOff"));
    const em = st.modules && st.modules.emotes;
    if (st.login && em) add(em.enabled ? (em.status ? em.status.text : t("pop.emotesOff")) : t("pop.emotesOff"));
    const pt = st.modules && st.modules.points;
    if (st.login && pt && pt.enabled && pt.status) add(pt.status.text);
  });
});
