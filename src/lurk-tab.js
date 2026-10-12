// Pestaña de Twitch abierta por el modo lurk (lurk.js la abre con ?dct-lurk=1). Corre antes que Twitch:
// - la marca queda en sessionStorage (de esta pestaña sola), porque Twitch borra los parámetros de la dirección al navegar;
// - pide la calidad mínima para el player de esta pestaña y, pasados unos segundos, devuelve la preferencia de calidad que la
//   persona tenía en Twitch (es una sola para todo twitch.tv);
// - vigila que la pestaña de verdad cuente: que haya sesión de Twitch, que el video avance (si Twitch lo deja pausado se reanuda)
//   y lee la racha de visualizaciones del menú de puntos del canal (la misma tarjeta «Racha de visualizaciones … 0/2» que ve la
//   persona). Todo se informa al service worker, que lo guarda en el historial del lurk y cierra la pestaña de racha cuando sube;
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

  const send = (msg) => { try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch { /* extensión recargada */ } };
  const report = (event, data) => send({ type: "lurkTab", event, data: data || {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  send({ type: "lurkPing" });
  setInterval(() => send({ type: "lurkPing" }), 30000);

  // ───────────── reproducción
  const LOGIN_BUTTON = '[data-a-target="login-button"]';
  let lastTime = -1, stuck = 0, playingSaid = false, sessionSaid = false;
  function watch() {
    if (!sessionSaid && document.querySelector(LOGIN_BUTTON)) { sessionSaid = true; report("nosession"); }
    const v = document.querySelector("video");
    if (!v) return;
    const advancing = v.currentTime !== lastTime && !v.paused;
    lastTime = v.currentTime;
    if (advancing) {
      stuck = 0;
      if (!playingSaid) { playingSaid = true; report("playing", { muted: v.muted, height: v.videoHeight || 0 }); }
      return;
    }
    if (++stuck < 2) return; // dos vueltas seguidas sin avanzar (20 s): se intenta reanudar
    stuck = 0;
    const p = v.play();
    if (p && p.catch) {
      p.then(() => report("resumed", { muted: v.muted })).catch(() => {
        // El navegador no deja reanudar con sonido sin un clic: se reanuda con el video silenciado (la pestaña ya lo está)
        v.muted = true;
        v.play().then(() => report("resumed", { muted: true })).catch(() => report("paused"));
      });
    }
  }


  // ───────────── racha de visualizaciones (menú de puntos del canal)
  const SUMMARY = '[data-test-selector="community-points-summary"]';
  const STREAK = /(racha de visualizaci|watch streak|racha de vista|sequência de|série de visionnage|zuschauer-serie|serie di visualizz)/i;
  const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();
  function findStreak() {
    let best = null, any = null;
    for (const n of document.querySelectorAll("div, section, li, p")) {
      const tx = n.textContent || "";
      if (tx.length > 500 || !STREAK.test(tx)) continue;
      if (!any || tx.length < any.textContent.length) any = n;
      if (/\d+\s*\/\s*\d+/.test(tx) && (!best || tx.length < best.textContent.length)) best = n;
    }
    if (best) {
      const m = best.textContent.match(/(\d+)\s*\/\s*(\d+)/);
      return { have: Number(m[1]), need: Number(m[2]), raw: clean(best.textContent).slice(0, 180) };
    }
    return any ? { raw: clean(any.textContent).slice(0, 180) } : null;
  }
  async function readStreak() {
    let r = findStreak();
    if (r && r.have != null) return r;
    const btn = document.querySelector(SUMMARY + " button");
    if (!btn) return { error: "nobutton" };
    btn.click();
    for (let i = 0; i < 8 && !(r && r.have != null); i++) { await sleep(500); r = findStreak(); }
    // Se cierra el menú: Escape y, si sigue abierto, el mismo botón
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(400);
    if (findStreak()) { try { btn.click(); } catch { /* el botón desapareció */ } }
    return r || { error: "notfound" };
  }
  let lastKey = null, failures = 0;
  async function streakTick() {
    const r = await readStreak().catch(() => ({ error: "exception" }));
    if (r && r.have != null) {
      failures = 0;
      const key = r.have + "/" + r.need;
      if (key !== lastKey) { lastKey = key; report("streak", r); }
    } else if (++failures === 3) report("streakUnreadable", { reason: (r && (r.error || "nofraction")) || "notfound", raw: r && r.raw });
  }
  // Primera lectura pronto (antes de que la racha suba, para tener con qué comparar) y luego cada 90 s
  // dctLurkTest solo lo pone la prueba de punta a punta (test/e2e-lurk.mjs) para usar tiempos cortos
  chrome.storage.local.get("dctLurkTest", (v) => {
    const fast = !!(v && v.dctLurkTest);
    setTimeout(() => { watch(); setInterval(watch, fast ? 1000 : 10000); }, fast ? 500 : 8000);
    setTimeout(() => { streakTick(); setInterval(streakTick, fast ? 1500 : 90000); }, fast ? 1000 : 20000);
  });
})();
