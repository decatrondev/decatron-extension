const DEFAULTS = { preferredLang: null, backgroundVolume: 0.15, delaySec: 0, captions: true, captionSource: false, captionSize: 22, autoJoin: true };
const LANG = { en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", it: "Italiano", ja: "日本語", ko: "한국어", ru: "Русский" };
const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS, (p) => {
  $("autoJoin").checked = !!p.autoJoin;
  $("preferredLang").value = p.preferredLang || "";
  $("backgroundVolume").value = Math.round(p.backgroundVolume * 100); $("bgv").textContent = Math.round(p.backgroundVolume * 100) + "%";
  $("delaySec").value = p.delaySec; $("dlv").textContent = p.delaySec + " s";
  $("captions").checked = !!p.captions;
  $("captionSource").checked = !!p.captionSource;
  $("captionSize").value = p.captionSize; $("csv").textContent = p.captionSize + "px";
});

$("autoJoin").onchange = (e) => chrome.storage.sync.set({ autoJoin: e.target.checked });
$("preferredLang").onchange = (e) => chrome.storage.sync.set({ preferredLang: e.target.value || null });
$("backgroundVolume").oninput = (e) => { $("bgv").textContent = e.target.value + "%"; chrome.storage.sync.set({ backgroundVolume: Number(e.target.value) / 100 }); };
$("delaySec").oninput = (e) => { $("dlv").textContent = e.target.value + " s"; chrome.storage.sync.set({ delaySec: Number(e.target.value) }); };
$("captions").onchange = (e) => chrome.storage.sync.set({ captions: e.target.checked });
$("captionSource").onchange = (e) => chrome.storage.sync.set({ captionSource: e.target.checked });
$("captionSize").oninput = (e) => { $("csv").textContent = e.target.value + "px"; chrome.storage.sync.set({ captionSize: Number(e.target.value) }); };

// Estado de la pestaña activa
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs[0];
  if (!tab || !/^https:\/\/www\.twitch\.tv\//.test(tab.url || "")) return;
  chrome.tabs.sendMessage(tab.id, { type: "state" }, (st) => {
    if (chrome.runtime.lastError || !st) return;
    if (!st.login) return;
    if (!st.enabled) {
      $("ch-title").textContent = st.login;
      $("ch-sub").textContent = "Este canal no ofrece traducción.";
      return;
    }
    $("ch-title").textContent = st.login;
    $("ch-sub").textContent = st.live ? "Traduciendo ahora. Solo tú lo escuchas." : "El streamer aún no encendió la traducción; se activará sola.";
    const box = $("langs");
    box.textContent = "";
    const mk = (lang, label) => {
      const b = document.createElement("button");
      b.className = "lang" + ((st.selected || null) === lang ? " on" : "");
      b.textContent = label;
      b.onclick = () => chrome.tabs.sendMessage(tab.id, { type: "select", lang }, () => window.close());
      box.append(b);
    };
    mk(null, "Original");
    for (const l of st.languages || []) mk(l, LANG[l] || l.toUpperCase());
  });
});
