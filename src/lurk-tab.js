// Pestaña de Twitch abierta por el modo lurk (lurk.js la abre con ?dct-lurk=1). Corre antes que Twitch:
// - la marca queda en sessionStorage (de esta pestaña sola), porque Twitch borra los parámetros de la dirección al navegar;
// - pide la calidad mínima para el player de esta pestaña y, cuando el video ya arrancó, devuelve la preferencia de calidad que la
//   persona tenía en Twitch (es una sola para todo twitch.tv). El player puede armarse minutos después de cargar la página (el
//   navegador no arranca video en una pestaña que nunca se mostró), por eso no se devuelve a tiempo fijo;
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
  let restoreQuality = () => {};
  try {
    const prev = localStorage.getItem(KEY);
    localStorage.setItem(KEY, JSON.stringify({ default: "160p30" }));
    restoreQuality = () => {
      restoreQuality = () => {};
      setTimeout(() => { try { if (prev === null) localStorage.removeItem(KEY); else localStorage.setItem(KEY, prev); } catch { /* sin almacenamiento */ } }, 5000);
    };
  } catch { /* sin almacenamiento */ }

  const send = (msg) => { try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch { /* extensión recargada */ } };
  const report = (event, data) => send({ type: "lurkTab", event, data: data || {} });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  send({ type: "lurkPing" });
  setInterval(() => send({ type: "lurkPing" }), 30000);

  // ───────────── reproducción
  const LOGIN_BUTTON = '[data-a-target="login-button"]';
  // El video del stream es el más grande (Twitch puede tener otro <video> para anuncios)
  const mainVideo = () => [...document.querySelectorAll("video")].sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0] || null;
  let lastTime = -1, stuck = 0, playingSaid = false, sessionSaid = false, resuming = false, wasPlaying = false;
  function watch() {
    if (!sessionSaid && document.querySelector(LOGIN_BUTTON)) { sessionSaid = true; report("nosession"); }
    const v = mainVideo();
    if (!v) return;
    const advancing = v.currentTime !== lastTime && !v.paused;
    lastTime = v.currentTime;
    if (advancing) {
      stuck = 0;
      if (!playingSaid) { playingSaid = true; restoreQuality(); report("playing", { muted: v.muted, height: v.videoHeight || 0 }); }
      else if (!wasPlaying) report("playing");
      wasPlaying = true;
      return;
    }
    // Hasta que el video arrancó una vez, esperarlo es cosa del navegador (no arranca en una pestaña que nunca se mostró): no se insiste
    if (!playingSaid || ++stuck < 2) return;
    stuck = 0;
    if (wasPlaying) { wasPlaying = false; report("paused"); }
    // Un solo pedido de reanudar a la vez (si no, se juntan y se resuelven todos de golpe). Sin silenciar el video: un video sin
    // sonido en segundo plano el navegador lo pausa solo; el sonido ya está apagado en la pestaña.
    if (resuming) return;
    resuming = true;
    const p = v.play();
    if (p && p.then) p.then(() => report("resumed")).catch(() => {}).finally(() => { resuming = false; });
    else resuming = false;
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
  // Texto del menú que se abrió (para el historial cuando no se encuentra la racha): lo que haya en un diálogo o globo de Twitch
  function menuText() {
    const box = document.querySelector('[role="dialog"], [data-test-selector*="popover"], [class*="Balloon"], [class*="balloon"]');
    return box ? clean(box.textContent).slice(0, 400) : "";
  }
  async function readStreak() {
    let r = findStreak();
    if (r && r.have != null) return r;
    const btn = document.querySelector(SUMMARY + " button");
    if (!btn) return { error: "nobutton" };
    btn.click();
    for (let i = 0; i < 8 && !(r && r.have != null); i++) { await sleep(500); r = findStreak(); }
    const menu = menuText();
    // Se cierra el menú: Escape y, si sigue abierto, el mismo botón
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
    await sleep(400);
    if (findStreak()) { try { btn.click(); } catch { /* el botón desapareció */ } }
    if (r && r.have != null) return r;
    return { error: r ? "nofraction" : "notfound", raw: r && r.raw, menu, hidden: document.hidden };
  }
  let lastKey = null, failures = 0;
  async function streakTick() {
    const r = await readStreak().catch(() => ({ error: "exception" }));
    if (r && r.have != null) {
      failures = 0;
      const key = r.have + "/" + r.need;
      if (key !== lastKey) { lastKey = key; report("streak", r); }
    } else if (++failures === 1 || failures % 7 === 0) {
      // La primera vez y luego cada ~10 min: qué se encontró, qué decía el menú y si la pestaña estaba oculta
      report("streakUnreadable", { reason: (r && r.error) || "notfound", raw: r && r.raw, menu: r && r.menu, hidden: !!(r && r.hidden) });
    }
  }

  // Segunda señal: cuando la racha sube, Twitch avisa en el chat para compartirla
  const SHARE = /(compart\w* (tu |la )?racha|share (your )?(watch )?streak)/i;
  let shareSaid = false;
  new MutationObserver((muts) => {
    if (shareSaid) return;
    for (const m of muts) for (const n of m.addedNodes) {
      const tx = n.textContent || "";
      if (tx.length < 400 && SHARE.test(tx)) { shareSaid = true; report("streakShare", { raw: clean(tx).slice(0, 180) }); return; }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  // Primera lectura pronto (antes de que la racha suba, para tener con qué comparar) y luego cada 90 s
  // dctLurkTest solo lo pone la prueba de punta a punta (test/e2e-lurk.mjs) para usar tiempos cortos
  chrome.storage.local.get("dctLurkTest", (v) => {
    const fast = !!(v && v.dctLurkTest);
    setTimeout(() => { watch(); setInterval(watch, fast ? 1000 : 10000); }, fast ? 500 : 8000);
    setTimeout(() => { streakTick(); setInterval(streakTick, fast ? 1500 : 90000); }, fast ? 1000 : 20000);
  });
})();
