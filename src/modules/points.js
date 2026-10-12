// Módulo de puntos de canal: reclama solo el bonus (el cofre «Claim Bonus») mientras ves un canal. Apagado por defecto.
// Solo hace clic en el botón del bonus, con un retardo aleatorio; no canjea recompensas ni apuesta puntos.
// Técnica: un MutationObserver vigila el botón `.claimable-bonus__icon` (la misma clase que usan otras extensiones desde hace
// años; las clases con hash de Twitch cambian solas y NO se usan) y le hace clic desde aquí, sin código en el mundo de la página.
(function () {
  const D = window.__decatron;
  const { t, h } = D;
  const kit = D.kit;

  const CLAIM = ".claimable-bonus__icon";
  const SUMMARY = ".community-points-summary";
  const BALANCE = '[data-test-selector="copo-balance-string"]';
  const LOGIN = '[data-a-target="login-button"]';
  const MIN_DELAY = 1000;
  const MAX_DELAY = 5000;      // retardo aleatorio entre el aviso del bonus y el clic
  const NONE_AFTER = 20000;    // sin ver el sistema de puntos tras este tiempo se avisa

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.9 11.6V15H9.2v-1.4a2.7 2.7 0 0 1-1.9-1.5l1.4-.8c.3.6.8.9 1.4.9.5 0 .9-.2.9-.6 0-.4-.3-.6-1.2-.9-1.2-.4-2-.9-2-2 0-.9.6-1.6 1.6-1.8V5h1.7v1.4c.7.1 1.2.5 1.6 1.1l-1.2.8c-.2-.4-.5-.6-1-.6-.4 0-.7.2-.7.5s.3.5 1.2.8c1.2.4 2 .9 2 2 0 1-.7 1.7-1.9 2Z"/></svg>`;

  /** «1,234», «12.3K», «1.2M» → { value, exact }. Twitch abrevia desde los miles: ahí la cuenta ya no es exacta. */
  function parseBalance(text) {
    const m = String(text || "").replace(/[\s,]/g, "").match(/^([\d.]+)([KkMm]?)$/);
    if (!m) return null;
    const n = parseFloat(m[1]);
    if (!Number.isFinite(n)) return null;
    const mult = /k/i.test(m[2]) ? 1e3 : /m/i.test(m[2]) ? 1e6 : 1;
    return { value: Math.round(n * mult), exact: !m[2] };
  }
  const readBalance = () => { const el = document.querySelector(BALANCE); return el ? parseBalance(el.textContent) : null; };

  /** Otras extensiones que también pueden reclamar solas. No hay conflicto (el bonus se reclama una vez), solo se avisa. */
  function otherClaimers() {
    const out = [];
    if (document.getElementById("ffz-script") || (document.body && document.body.dataset && document.body.dataset.ffzSource)) out.push("FrankerFaceZ");
    if (document.querySelector('script[src*="betterttv"]') || (document.body && [...document.body.classList].some((c) => c.startsWith("bttv")))) out.push("BetterTTV");
    return out;
  }

  const mod = {
    id: "points",
    order: 3,
    icon: ICON,
    defaults: { enabled: false, blocked: [] },
    name: () => t("pt.name"),
    description: () => t("pt.desc"),

    state: { status: "idle", claimed: 0, lastAt: 0 },
    observer: null,
    probeTimer: null,
    scanTimer: null,
    scheduled: new WeakSet(),
    toast: null,
    since: 0,

    settings: () => D.moduleSettings("points"),
    isBlocked() { return !!D.channel && (mod.settings().blocked || []).includes(D.channel); },
    setBlocked(blocked) {
      const set = new Set(mod.settings().blocked || []);
      if (blocked) set.add(D.channel); else set.delete(D.channel);
      D.setModuleSettings("points", { blocked: [...set] });
    },

    status() {
      const s = mod.state;
      return { active: s.status === "ready" && !mod.isBlocked(), text: t("pt.status." + s.status, { n: s.claimed }) };
    },

    start() {
      mod.since = Date.now();
      // El observador solo marca que hay que mirar; el escaneo real se junta en uno cada 250 ms.
      mod.observer = new MutationObserver(() => {
        if (mod.scanTimer) return;
        mod.scanTimer = setTimeout(() => { mod.scanTimer = null; mod.scan(); }, 250);
      });
      mod.observer.observe(document.body, { childList: true, subtree: true });
      mod.probeTimer = setInterval(() => { mod.probe(); mod.scan(); }, 4000);
      mod.probe();
      mod.scan();
    },

    stop() {
      if (mod.observer) mod.observer.disconnect();
      mod.observer = null;
      clearInterval(mod.probeTimer); mod.probeTimer = null;
      clearTimeout(mod.scanTimer); mod.scanTimer = null;
      mod.state.status = "idle";
    },

    onChannel() {
      mod.since = Date.now();
      mod.state.status = "idle";
      mod.probe();
    },

    /** Qué pasa en esta página: sin canal, sin sesión, sin sistema de puntos (aún) o listo. */
    probe() {
      let status = "idle";
      if (D.channel) {
        if (document.querySelector(LOGIN)) status = "login";
        else if (document.querySelector(SUMMARY)) status = "ready";
        else status = Date.now() - mod.since > NONE_AFTER ? "none" : "waiting";
      }
      if (status !== mod.state.status) { mod.state.status = status; D.emit("module-update", null); }
    },

    scan() {
      if (!D.channel || mod.isBlocked()) return;
      for (const node of document.querySelectorAll(CLAIM)) mod.schedule(node);
    },

    schedule(node) {
      if (mod.scheduled.has(node)) return;
      // Un botón destructivo (cancelar, descartar) no es el del bonus
      if (String(node.className).includes("ScCoreButtonDestructive")) return;
      mod.scheduled.add(node);
      const wait = MIN_DELAY + Math.random() * (MAX_DELAY - MIN_DELAY);
      setTimeout(() => mod.claim(node), wait);
    },

    claim(node) {
      // Otra extensión (o la persona) pudo reclamarlo ya, o el módulo se apagó / se bloqueó el canal durante la espera
      if (!node.isConnected || !D.isEnabled("points") || mod.isBlocked() || !D.channel) return;
      const before = readBalance();
      try { node.click(); } catch { return; }
      mod.state.claimed += 1;
      mod.state.lastAt = Date.now();
      D.emit("module-update", null);
      // El saldo se actualiza un instante después del clic: ahí se ve cuánto fue
      setTimeout(() => {
        const after = readBalance();
        const gain = before && after && before.exact && after.exact ? after.value - before.value : null;
        mod.showToast(gain != null && gain > 0 && gain <= 100000 ? t("pt.gained", { n: gain }) : t("pt.claimed"));
      }, 1500);
    },

    showToast(text) {
      if (mod.toast) mod.toast.remove();
      const el = h("div", { class: "dct-pts-toast", role: "status" }, text);
      const summary = document.querySelector(SUMMARY);
      const r = summary ? summary.getBoundingClientRect() : null;
      el.style.left = (r ? Math.max(8, r.left) : 16) + "px";
      el.style.top = (r ? Math.max(8, r.top - 38) : 16) + "px";
      document.body.append(el);
      mod.toast = el;
      setTimeout(() => { if (mod.toast === el) mod.toast = null; el.remove(); }, 3600);
    },

    renderPanel(body) {
      const box = h("div", { class: "sec" });
      const paint = () => {
        box.textContent = "";
        const s = mod.state;
        if (!D.channel) { box.append(kit.notice(t("pt.noChannel"))); return; }
        const tone = s.status === "ready" ? "ok" : s.status === "login" || s.status === "none" ? "warn" : "";
        box.append(kit.notice(t("pt.status." + s.status, { n: s.claimed }), tone));
        if (s.claimed > 0) box.append(h("div", { style: "height:8px" }), kit.notice(t("pt.session", { n: s.claimed })));
        const others = otherClaimers();
        if (others.length) box.append(h("div", { style: "height:8px" }), kit.notice(t("pt.others", { names: others.join(", ") })));
      };
      paint();
      const off = D.on("module-update", paint);

      body.append(
        kit.section(null, h("p", { class: "muted" }, t("pt.hint"))),
        D.channel ? kit.section(null, kit.toggleRow(t("pt.thisChannel"), t("pt.thisChannelHint"), !mod.isBlocked(), (v) => { mod.setBlocked(!v); paint(); })) : null,
        box,
      );
      return () => off();
    },
  };

  D.register(mod);
})();
