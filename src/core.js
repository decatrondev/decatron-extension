// Núcleo de Decatron en la página: preferencias, registro de módulos y utilidades comunes.
// Cada módulo (traducción, emotes, puntos de canal...) se registra aquí y el resto no se entera de los demás.
(function () {
  const i18n = window.__dctI18n;

  /** Valores de fábrica. Las claves de traducción siguen planas (así se guardaban en la 0.1.x y nadie pierde lo suyo). */
  const DEFAULT_PREFS = {
    preferredLang: null, backgroundVolume: 0.15, delaySec: 0, captions: true, captionSource: false, captionSize: 22, autoJoin: true,
    modules: {},
  };

  const D = {
    version: (() => { try { return chrome.runtime.getManifest().version; } catch { return ""; } })(),
    t: i18n.t,
    lang: i18n.lang,
    prefs: { ...DEFAULT_PREFS },
    channel: null,          // login del canal actual (null fuera de un canal)
    modules: new Map(),     // id → módulo, en orden de registro
    listeners: new Map(),

    // ───────────── eventos
    on(event, fn) {
      if (!D.listeners.has(event)) D.listeners.set(event, new Set());
      D.listeners.get(event).add(fn);
      return () => D.listeners.get(event).delete(fn);
    },
    emit(event, payload) {
      const set = D.listeners.get(event);
      if (set) for (const fn of [...set]) { try { fn(payload); } catch (e) { console.warn("[decatron]", event, e); } }
    },

    // ───────────── preferencias (chrome.storage.sync)
    loadPrefs() {
      return new Promise((resolve) => {
        try {
          chrome.storage.sync.get(DEFAULT_PREFS, (v) => { D.prefs = { ...DEFAULT_PREFS, ...v, modules: { ...(v && v.modules) } }; resolve(D.prefs); });
        } catch { resolve(D.prefs); }
      });
    },
    setPrefs(patch) {
      Object.assign(D.prefs, patch);
      try { chrome.storage.sync.set(patch); } catch { /* sin storage */ }
      D.emit("prefs", patch);
    },

    /** Ajustes de un módulo con sus valores de fábrica por debajo */
    moduleSettings(id) {
      const m = D.modules.get(id);
      return { ...((m && m.defaults) || {}), ...(D.prefs.modules[id] || {}) };
    },
    setModuleSettings(id, patch) {
      const next = { ...(D.prefs.modules[id] || {}), ...patch };
      D.prefs.modules = { ...D.prefs.modules, [id]: next };
      try { chrome.storage.sync.set({ modules: D.prefs.modules }); } catch { /* sin storage */ }
      D.emit("module-settings", { id, patch });
    },
    isEnabled(id) { return D.moduleSettings(id).enabled !== false; },

    // ───────────── módulos
    register(mod) { D.modules.set(mod.id, mod); },

    /** Mensaje al service worker; resuelve con la respuesta o null si falla */
    sw(message) {
      return new Promise((resolve) => {
        try { chrome.runtime.sendMessage(message, (r) => resolve(chrome.runtime.lastError ? null : r)); }
        catch { resolve(null); }
      });
    },

    // ───────────── DOM
    /** h("div", {class:"x", onclick: fn}, "texto", otroNodo) */
    h(tag, props, ...children) {
      const e = document.createElement(tag);
      for (const [k, v] of Object.entries(props || {})) {
        if (v == null || v === false) continue;
        if (k === "class") e.className = v;
        else if (k === "text") e.textContent = v;
        else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2).toLowerCase(), v);
        else if (k === "checked" || k === "value" || k === "disabled" || k === "hidden") e[k] = v;
        else e.setAttribute(k, v === true ? "" : v);
      }
      for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
      return e;
    },

    /** Un nodo SVG a partir de su texto (sin innerHTML: las tiendas de extensiones lo desaconsejan) */
    svg(markup) {
      const doc = new DOMParser().parseFromString(markup, "image/svg+xml");
      return document.importNode(doc.documentElement, true);
    },

    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };

  // Cambios hechos desde otro lado (el popup, otra pestaña) llegan solos
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync") return;
      const patch = {};
      for (const k of Object.keys(changes)) patch[k] = changes[k].newValue;
      if (patch.modules) patch.modules = { ...patch.modules };
      Object.assign(D.prefs, patch);
      D.emit("prefs", patch);
      if (patch.modules) D.emit("module-settings", { id: null, patch: {} });
    });
  } catch { /* sin storage */ }

  window.__decatron = D;
})();
