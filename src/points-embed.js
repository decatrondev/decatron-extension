// Puntos de canal dentro del chat oficial embebido (el de las casillas de decatron.net/multi): allí no corre el resto de la extensión,
// solo esto. Hace lo mismo que el módulo de puntos en twitch.tv, con las mismas reglas: SOLO el bonus, apagado por defecto (se enciende
// con el mismo interruptor del popup), retardo aleatorio de 1 a 5 s y el canal excluido no se toca.
(function () {
  const m = location.pathname.match(/^\/embed\/([^/]+)\/chat/i);
  if (!m) return;
  const channel = decodeURIComponent(m[1]).toLowerCase();
  const CLAIM = ".claimable-bonus__icon";
  const MIN_DELAY = 1000, MAX_DELAY = 5000;
  const scheduled = new WeakSet();
  let enabled = false, blocked = [];

  const apply = (modules) => {
    const p = (modules && modules.points) || {};
    enabled = p.enabled === true;
    blocked = Array.isArray(p.blocked) ? p.blocked.map((x) => String(x).toLowerCase()) : [];
  };
  const allowed = () => enabled && !blocked.includes(channel);

  function scan() {
    if (!allowed()) return;
    for (const node of document.querySelectorAll(CLAIM)) {
      if (scheduled.has(node) || String(node.className).includes("ScCoreButtonDestructive")) continue;
      scheduled.add(node);
      setTimeout(() => {
        // Otra extensión (o la persona) pudo reclamarlo ya, o se apagó el módulo durante la espera
        if (!node.isConnected || !allowed()) return;
        try { node.click(); } catch { /* el botón desapareció */ }
      }, MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY));
    }
  }

  try {
    chrome.storage.sync.get({ modules: {} }, (v) => { apply(v && v.modules); scan(); });
    chrome.storage.onChanged.addListener((changes, area) => { if (area === "sync" && changes.modules) { apply(changes.modules.newValue); scan(); } });
  } catch { return; }
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
  setInterval(scan, 4000);
})();
