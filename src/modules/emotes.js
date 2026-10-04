// Módulo de emotes: carga el diccionario del canal (propios de Decatron + 7TV + BTTV + FFZ) y dibuja los emotes en el chat de Twitch,
// reemplazando las palabras que coinciden. No toca los emotes nativos de Twitch.
(function () {
  const D = window.__decatron;
  const { t, h, kit } = D;

  const SMILE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm-3 5.2a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4Zm6 0a1.2 1.2 0 1 1 0 2.4 1.2 1.2 0 0 1 0-2.4ZM10 15.2a5 5 0 0 1-4.3-2.5.8.8 0 0 1 1.4-.8 3.4 3.4 0 0 0 5.8 0 .8.8 0 1 1 1.4.8 5 5 0 0 1-4.3 2.5Z"/></svg>`;
  const SIZES = { small: 22, normal: 28, large: 38 };
  const CHAT = ".chat-scrollable-area__message-container";
  const LINE = ".chat-line__message";
  const BODY = '[data-a-target="chat-line-message-body"]';
  // Los trozos de texto de un mensaje: en Twitch están dentro del cuerpo del mensaje; FrankerFaceZ rehace las líneas y los deja dentro de span.message
  const FRAGMENT = '[data-a-target="chat-line-message-body"] > .text-fragment, .message > .text-fragment';
  const OTHER_EXT = '[class*="seventv"], seventv-container, [class*="bttv"], .bttv-tooltip-container, [class*="ffz-"], .ffz--inline';

  const mod = {
    id: "emotes",
    order: 2,
    icon: SMILE,
    defaults: { enabled: true, own: true, sevenTv: true, bttv: true, ffz: true, globals: true, other: "always", size: "normal", picker: true },
    name: () => t("em.name"),
    description: () => t("em.desc"),

    state: { status: "idle", count: 0 },
    dict: new Map(),
    entries: [],
    observer: null,
    watched: null,
    watchTimer: null,
    picker: null,
    reloadTimer: null,
    loadToken: 0,
    otherCache: { at: 0, value: false },

    status() {
      const s = mod.state;
      return { active: s.status === "ready" && s.count > 0, text: t("em.status.ready", { n: s.count }) };
    },

    setState(patch) { Object.assign(mod.state, patch); D.emit("module-update", "emotes"); },

    start() {
      applySize();
      lastFlags = JSON.stringify(providerFlags());
      mod.watchTimer = setInterval(watchChat, 1000);
      mod.picker = new window.__decatronEmotePicker(() => (mod.settings().picker ? effectiveEntries() : []));
      mod.picker.start();
      mod.listener = D.on("module-settings", onSettings);
    },

    stop() {
      if (mod.watchTimer) clearInterval(mod.watchTimer);
      mod.watchTimer = null;
      if (mod.observer) mod.observer.disconnect();
      mod.observer = null;
      mod.watched = null;
      if (mod.picker) mod.picker.stop();
      mod.picker = null;
      if (mod.listener) mod.listener();
      mod.dict = new Map();
      mod.entries = [];
      mod.loadToken++;
      mod.setState({ status: "idle", count: 0 });
    },

    settings() { return D.moduleSettings("emotes"); },

    onChannel(login) {
      mod.dict = new Map();
      mod.entries = [];
      mod.setState({ status: login ? "loading" : "idle", count: 0 });
      if (login) load(login, false);
    },

    // ───────────── panel
    renderPanel(body) {
      const s0 = () => mod.settings();
      const statusBox = h("div", { class: "sec" });
      const previewBox = h("div", { class: "sec" });

      const renderStatus = () => {
        statusBox.textContent = "";
        const s = mod.state;
        if (!D.channel) { statusBox.append(kit.notice(t("em.noChannel"))); previewBox.textContent = ""; return; }
        if (s.status === "loading") statusBox.append(kit.notice(t("em.status.loading")));
        else if (s.status === "error") statusBox.append(kit.notice(t("em.status.error"), "warn"));
        else if (s.status === "ready") {
          statusBox.append(kit.notice(t("em.status.ready", { n: s.count }), "ok"));
          if (otherDetected() && s0().other === "auto") statusBox.append(h("div", { style: "height:8px" }), kit.notice(t("em.status.other"), "warn"));
        }
        previewBox.textContent = "";
        const sample = effectiveEntries().filter((e) => !e.z).slice(0, 8);
        if (sample.length) previewBox.append(h("div", { class: "preview" }, sample.map((e) => h("img", { src: e.u, alt: e.n, title: e.n }))));
      };

      const reloadBtn = h("button", { class: "btn", onclick: async () => {
        reloadBtn.disabled = true;
        if (D.channel) await load(D.channel, true);
        reloadBtn.textContent = t("em.reloaded");
        setTimeout(() => { reloadBtn.textContent = t("em.reload"); reloadBtn.disabled = false; }, 1500);
      } }, t("em.reload"));

      const set = (patch) => D.setModuleSettings("emotes", patch);
      body.append(
        statusBox, previewBox,
        kit.section(t("em.sources"),
          kit.toggleRow(t("em.own"), t("em.ownHint"), s0().own, (v) => set({ own: v })),
          kit.toggleRow(t("em.7tv"), null, s0().sevenTv, (v) => set({ sevenTv: v })),
          kit.toggleRow(t("em.bttv"), null, s0().bttv, (v) => set({ bttv: v })),
          kit.toggleRow(t("em.ffz"), null, s0().ffz, (v) => set({ ffz: v })),
          kit.toggleRow(t("em.globals"), t("em.globalsHint"), s0().globals, (v) => set({ globals: v })),
          kit.row(t("em.other"), null, kit.select(s0().other, [["auto", t("em.other.auto")], ["always", t("em.other.always")]], (v) => set({ other: v})))),
        kit.section(t("em.look"),
          kit.row(t("em.size"), null, kit.select(s0().size, [["small", t("em.size.small")], ["normal", t("em.size.normal")], ["large", t("em.size.large")]], (v) => set({ size: v }))),
          kit.toggleRow(t("em.picker"), t("em.pickerHint"), s0().picker, (v) => set({ picker: v })),
          h("div", { style: "padding-top:10px" }, reloadBtn)),
        kit.section(t("em.diag"), h("p", { class: "row-hint" }, t("em.diagHint")), diagBox()),
        h("p", { class: "row-hint" }, t("em.note")));

      renderStatus();
      return D.on("module-update", (id) => { if (id === "emotes") renderStatus(); });
    },
  };

  // ───────────── carga del diccionario
  function providerFlags() {
    const s = mod.settings();
    return { own: s.own, sevenTv: s.sevenTv, bttv: s.bttv, ffz: s.ffz, globals: s.globals };
  }

  async function load(login, fresh) {
    const token = ++mod.loadToken;
    mod.setState({ status: "loading" });
    const r = await D.sw({ type: "getEmotes", login, providers: providerFlags(), fresh: !!fresh });
    if (token !== mod.loadToken || D.channel !== login) return;   // cambió de canal o llegó otra carga más nueva
    if (!r || !r.ok) { mod.setState({ status: "error", count: 0 }); return; }
    mod.entries = r.entries;
    mod.dict = new Map(r.entries.map((e) => [e.n, e]));
    mod.setState({ status: "ready", count: r.entries.length });
    // Los mensajes que ya estaban en pantalla antes de tener el diccionario
    reprocessAll();
  }

  /** Cambios de ajustes: el tamaño se aplica ya; los proveedores piden un diccionario nuevo (con un poco de espera por si mueven varios) */
  let lastFlags = null;
  function onSettings() {
    applySize();
    const flags = JSON.stringify(providerFlags());
    if (lastFlags !== null && flags !== lastFlags && D.channel) {
      clearTimeout(mod.reloadTimer);
      mod.reloadTimer = setTimeout(() => D.channel && load(D.channel, false), 400);
    }
    lastFlags = flags;
    if (!mod.settings().picker && mod.picker) mod.picker.hide();
  }

  function applySize() {
    document.documentElement.style.setProperty("--dct-emote-h", (SIZES[mod.settings().size] || SIZES.normal) + "px");
  }

  // ───────────── otras extensiones de emotes
  function otherDetected() {
    const now = Date.now();
    if (now - mod.otherCache.at > 2000) mod.otherCache = { at: now, value: !!document.querySelector(OTHER_EXT) };
    return mod.otherCache.value;
  }

  /** Los emotes que hay que dibujar ahora: con otra extensión detectada (y en "auto"), solo los propios de Decatron */
  function effectiveEntries() {
    if (mod.settings().other === "auto" && otherDetected()) return mod.entries.filter((e) => e.p === "own");
    return mod.entries;
  }

  // ───────────── chat
  function watchChat() {
    if (!D.channel || !D.isEnabled("emotes")) return;
    const chat = document.querySelector(CHAT);
    if (chat === mod.watched) return;
    if (mod.observer) mod.observer.disconnect();
    mod.watched = chat;
    if (!chat) return;
    mod.observer = new MutationObserver((records) => {
      for (const rec of records) for (const node of rec.addedNodes) handleNode(node);
    });
    mod.observer.observe(chat, { childList: true, subtree: true });
    reprocessAll();
  }

  function reprocessAll() {
    const chat = mod.watched || document.querySelector(CHAT);
    if (chat) for (const line of chat.querySelectorAll(LINE)) processLine(line);
  }

  function handleNode(node) {
    if (node.nodeType !== 1) return;
    // Twitch puede armar la línea por partes: lo que se agrega dentro de una línea ya existente también cuenta
    const line = node.closest && node.closest(LINE);
    if (line) { processLine(line); return; }
    if (node.matches && node.matches(LINE)) processLine(node);
    else if (node.querySelectorAll) for (const l of node.querySelectorAll(LINE)) processLine(l);
  }

  /** Los textos de un mensaje: se parte por palabras y las que son un emote del diccionario pasan a ser imágenes */
  function processLine(line) {
    if (mod.dict.size === 0) return;
    const ownOnly = mod.settings().other === "auto" && otherDetected();
    // Cada trozo de texto se marca por separado: si Twitch (o FFZ) completa la línea después, los que faltan se procesan igual
    for (const frag of line.querySelectorAll(FRAGMENT)) {
      if (frag.dataset.dct === "1") continue;
      frag.dataset.dct = "1";
      replaceText(frag, mod.dict, ownOnly);
    }
  }

  function replaceText(span, dict, ownOnly) {
    const text = span.textContent;
    if (!text || !/\S/.test(text)) return;
    const usable = (e) => !!e && (!ownOnly || e.p === "own");
    const parts = text.split(/(\s+)/);
    if (!parts.some((p) => usable(dict.get(p)))) return;

    const out = document.createDocumentFragment();
    let lastWrap = null;      // el último emote dibujado, mientras desde él solo haya espacios: ahí se apilan los "encima del anterior"
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) { out.append(document.createTextNode(part)); continue; }
      const e = dict.get(part);
      if (!usable(e)) { out.append(document.createTextNode(part)); lastWrap = null; continue; }
      const img = h("img", { class: "dct-emote-img", src: e.u, alt: e.n, draggable: "false", loading: "lazy" });
      if (e.z && lastWrap) {
        img.className = "dct-emote-img dct-emote-zw";
        lastWrap.append(img);
        continue;
      }
      const wrap = h("span", { class: "dct-emote", "data-dct-emote": e.n, title: t("em.tipTitle", { name: e.n, provider: t("em.provider." + e.p) }) }, img);
      out.append(wrap);
      lastWrap = wrap;
    }
    span.replaceChildren(out);
  }

  // ───────────── diagnóstico (para saber qué pasa en el chat de quien lo usa)
  function diagnose() {
    const chat = document.querySelector(CHAT);
    const lines = chat ? [...chat.querySelectorAll(LINE)] : [];
    const bodies = lines.filter((l) => l.querySelector(BODY) || l.querySelector(".message"));
    const fragments = lines.flatMap((l) => [...l.querySelectorAll(FRAGMENT)]);
    const drawn = lines.filter((l) => l.querySelector(".dct-emote"));
    // Mensajes que traen una palabra del diccionario y siguen como texto
    const missed = fragments.filter((f) => !f.querySelector(".dct-emote") && f.textContent.split(/\s+/).some((w) => mod.dict.has(w)));
    const out = [
      `versión ${D.version} · canal ${D.channel || "-"} · página ${location.pathname}`,
      `módulo: ${mod.settings().enabled === false ? "apagado" : "encendido"} · estado: ${mod.state.status} · diccionario: ${mod.dict.size} emotes (${mod.entries.filter((e) => e.p === "own").length} propios)`,
      `otra extensión de emotes detectada: ${otherDetected() ? "sí" : "no"} · modo: ${mod.settings().other}`,
      `contenedor del chat: ${chat ? "encontrado" : "NO encontrado"} · observado: ${mod.watched ? "sí" : "no"}`,
      `líneas: ${lines.length} · con cuerpo de mensaje: ${bodies.length} · trozos de texto: ${fragments.length} · líneas con emotes dibujados: ${drawn.length}`,
      `trozos con un emote del diccionario que siguen como texto: ${missed.length}`,
    ];
    for (const f of missed.slice(0, 3)) out.push(`  ejemplo: «${f.textContent.trim().slice(0, 60)}» · marcado: ${f.dataset.dct || "no"} · línea: ${f.closest(LINE) ? "sí" : "no"}`);
    const own = mod.entries.filter((e) => e.p === "own").slice(0, 6).map((e) => e.n);
    if (own.length) out.push(`propios: ${own.join(", ")}`);

    // Lo que hay en toda la página, por si el chat no está donde esperamos
    const anywhere = [...document.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, .vod-message, [class*="chat-line"]')];
    out.push(`en toda la página: ${anywhere.length} elementos de línea de chat · mensajes de otros marcos: ${window.frames.length} marcos`);
    const last = lines[lines.length - 1] || anywhere[anywhere.length - 1];
    if (last) {
      const chain = [];
      for (let n = last.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) chain.push(`${n.tagName.toLowerCase()}${n.className && typeof n.className === "string" ? "." + n.className.trim().split(/\s+/).filter((c) => !/^(Layout|InjectLayout|ScCore)/.test(c)).slice(0, 2).join(".") : ""}`);
      out.push(`última línea dentro de: ${chain.join(" < ")}`);
      const body = last.querySelector(BODY);
      out.push(`cuerpo de la última línea: ${body ? body.outerHTML.slice(0, 380) : "(no tiene [data-a-target=chat-line-message-body])"}`);
      if (!body) out.push(`la última línea: ${last.outerHTML.slice(0, 380)}`);
    }
    return out.join("\n");
  }

  function diagBox() {
    const pre = h("pre", { class: "diag" });
    const run = h("button", { class: "btn", onclick: () => { pre.textContent = diagnose(); pre.hidden = false; copy.hidden = false; } }, t("em.diagRun"));
    const copy = h("button", { class: "btn", hidden: true, onclick: async () => {
      try { await navigator.clipboard.writeText(pre.textContent); copy.textContent = t("em.diagCopied"); setTimeout(() => { copy.textContent = t("em.diagCopy"); }, 1500); } catch { /* sin permiso */ }
    } }, t("em.diagCopy"));
    pre.hidden = true;
    return h("div", null, h("div", { style: "display:flex;gap:8px" }, run, copy), pre);
  }

  D.register(mod);
})();
