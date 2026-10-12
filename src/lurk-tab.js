// Pestaña de Twitch abierta por el modo lurk (lurk.js la abre con ?dct-lurk=1). Corre antes que Twitch:
// - la marca queda en sessionStorage (de esta pestaña sola), porque Twitch borra los parámetros de la dirección al navegar;
// - pide la calidad mínima para el player de esta pestaña y, pasados unos segundos, devuelve la preferencia de calidad que la
//   persona tenía en Twitch (es una sola para todo twitch.tv);
// - avisa al service worker cada 30 s para que revise el lurk aunque la página de /multi esté dormida en segundo plano;
// - main.js ve window.__dctLurk y en esta pestaña solo arranca el módulo de puntos (sin traducción ni emotes).
(function () {
  let lurk = false;
  try { lurk = new URLSearchParams(location.search).get("dct-lurk") === "1" || sessionStorage.getItem("dct-lurk") === "1"; } catch { return; }
  if (!lurk) return;
  try { sessionStorage.setItem("dct-lurk", "1"); } catch { /* sin almacenamiento */ }
  window.__dctLurk = true;

  const KEY = "video-quality";
  try {
    const prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, JSON.stringify({ default: "160p30" }));
    setTimeout(() => { try { if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev); } catch { /* sin almacenamiento */ } }, 20000);
  } catch { /* sin almacenamiento */ }

  const ping = () => { try { chrome.runtime.sendMessage({ type: "lurkPing" }, () => void chrome.runtime.lastError); } catch { /* extensión recargada */ } };
  ping();
  setInterval(ping, 30000);
})();
