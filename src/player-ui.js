// UI dentro del player de Twitch: botón en la barra de controles, menú de idioma y
// subtítulos sobre el video. Sin framework; los estilos están en player.css con el
// prefijo dct- para no chocar con los de Twitch.
(function () {
  const LANG_NAMES = { en: "English", es: "Español", pt: "Português", fr: "Français", de: "Deutsch", it: "Italiano", ja: "日本語", ko: "한국어", ru: "Русский" };
  const langName = (c) => LANG_NAMES[c] || c.toUpperCase();

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  class PlayerUi {
    /**
     * @param {HTMLElement} playerRoot contenedor del player (para el overlay de subtítulos)
     * @param {HTMLElement} controlsGroup grupo derecho de la barra de controles
     */
    constructor(playerRoot, controlsGroup, prefs) {
      this.prefs = prefs;
      this.root = playerRoot;
      this.rootProvider = null;  // () => contenedor actual del player; Twitch lo reemplaza al re-renderizar
      this.onselect = null;      // (lang|null)
      this.onprefs = null;       // (prefs parciales)
      this.onopen = null;        // el menú se abrió (refrescar oyentes)
      this.state = { enabled: false, live: false, languages: [], listeners: {}, selected: null, connection: "idle" };

      // Botón junto al engranaje
      this.button = el("button", "dct-btn");
      this.button.setAttribute("aria-label", "Escuchar en otro idioma");
      this.button.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm5.9 7h-2.6a12.8 12.8 0 0 0-1.1-4.3A6 6 0 0 1 15.9 9ZM10 4c.9 1.1 1.6 2.9 1.8 5H8.2C8.4 6.9 9.1 5.1 10 4ZM4.1 11h2.6c.1 1.6.5 3 1.1 4.3A6 6 0 0 1 4.1 11Zm2.6-2H4.1a6 6 0 0 1 3.7-4.3C7.2 6 6.8 7.4 6.7 9ZM10 16c-.9-1.1-1.6-2.9-1.8-5h3.6c-.2 2.1-.9 3.9-1.8 5Zm2.2-.7c.6-1.3 1-2.7 1.1-4.3h2.6a6 6 0 0 1-3.7 4.3Z"/></svg><span class="dct-dot"></span>`;
      this.button.addEventListener("click", (e) => { e.stopPropagation(); console.info("[decatron] clic en el botón; menú montado:", document.contains(this.menu)); this.toggleMenu(); });
      const settings = controlsGroup.querySelector('button[data-a-target="player-settings-button"]');
      const wrap = el("div", "dct-btn-wrap");
      wrap.appendChild(this.button);
      if (settings && settings.parentElement && settings.parentElement.parentElement === controlsGroup) controlsGroup.insertBefore(wrap, settings.parentElement);
      else controlsGroup.insertBefore(wrap, controlsGroup.firstChild);
      this.wrap = wrap;

      // Menú
      this.menu = el("div", "dct-menu");
      this.menu.hidden = true;
      this.menu.addEventListener("click", (e) => e.stopPropagation());
      playerRoot.appendChild(this.menu);
      document.addEventListener("click", this._outside = () => this.closeMenu());
      document.addEventListener("keydown", this._esc = (e) => { if (e.key === "Escape") this.closeMenu(); });

      // Aviso de audio bloqueado (Chrome exige un gesto para sonar)
      this.toast = el("div", "dct-toast");
      this.toast.hidden = true;
      this.toastText = el("span", null, "Chrome bloqueó el audio de la traducción.");
      this.toast.append(this.toastText);
      const unlockBtn = el("button", "dct-toast-btn", "Activar audio");
      const onUnlock = (e) => { e.stopPropagation(); e.preventDefault(); console.info("[decatron] clic en Activar audio"); this.onunlock && this.onunlock(); };
      unlockBtn.addEventListener("click", onUnlock);
      unlockBtn.addEventListener("pointerup", (e) => e.stopPropagation());
      unlockBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      this.toast.append(unlockBtn);
      playerRoot.appendChild(this.toast);
      this.onunlock = null;

      // Subtítulos
      this.captions = el("div", "dct-captions");
      this.captions.hidden = true;
      this.captionSource = el("div", "dct-cap-src");
      this.captionText = el("div", "dct-cap-text");
      this.captions.append(this.captionSource, this.captionText);
      playerRoot.appendChild(this.captions);
      this.applyCaptionPrefs();

      this.render();
    }

    setState(patch) { Object.assign(this.state, patch); this.render(); }

    setAudioBlocked(blocked, reason) {
      if (blocked) { this.ensureMounted(); console.info("[decatron] aviso de audio bloqueado:", reason || "sin motivo", new Error().stack.split("\n").slice(2, 5).join(" ← ")); }
      this.toastText.textContent = reason ? `Chrome no deja reproducir el audio (${reason}).` : "Chrome bloqueó el audio de la traducción.";
      this.toast.hidden = !blocked || !this.state.selected;
    }

    /** Twitch vuelve a crear el contenedor del player: si nuestros nodos quedaron en el viejo, moverlos al nuevo. */
    ensureMounted() {
      const fresh = this.rootProvider && this.rootProvider();
      if (fresh && fresh !== this.root) this.root = fresh;
      if (!this.root || !document.contains(this.root)) return false;
      for (const n of [this.menu, this.toast, this.captions])
        if (!this.root.contains(n)) this.root.appendChild(n);
      return true;
    }

    toggleMenu() { this.menu.hidden ? this.openMenu() : this.closeMenu(); }
    openMenu() { this.ensureMounted(); this.renderMenu(); this.menu.hidden = false; this.button.classList.add("dct-open"); this._toastWasVisible = !this.toast.hidden; this.toast.hidden = true; this.onopen && this.onopen(); }
    closeMenu() { if (this.menu.hidden) return; this.menu.hidden = true; this.button.classList.remove("dct-open"); if (this._toastWasVisible && this.state.selected) this.toast.hidden = false; }

    render() {
      const s = this.state;
      this.wrap.hidden = !s.enabled;
      this.button.classList.toggle("dct-active", !!s.selected);
      this.button.classList.toggle("dct-live", s.live);
      this.button.title = s.selected ? `Escuchando en ${langName(s.selected)}` : (s.live ? "Este canal se puede escuchar en otro idioma" : "Traducción disponible cuando el streamer la active");
      if (!s.selected) this.toast.hidden = true;
      if (!this.menu.hidden) this.renderMenu();
    }

    renderMenu() {
      const s = this.state;
      const m = this.menu;
      m.textContent = "";

      const head = el("div", "dct-menu-head");
      head.append(el("div", "dct-menu-title", "Escuchar en"));
      const sub = el("div", "dct-menu-sub");
      if (!s.live) sub.textContent = "El streamer aún no encendió la traducción. Puedes dejar tu idioma elegido y arrancará sola.";
      else if (s.connection === "connecting" || s.connection === "reconnecting") sub.textContent = "Conectando…";
      else sub.textContent = "Solo tú escuchas la traducción. El chat y los demás no cambian.";
      head.append(sub);
      m.append(head);

      const list = el("div", "dct-list");
      const orig = this._row(null, "Original", s.selected == null, null);
      list.append(orig);
      for (const lang of s.languages) {
        const n = s.listeners[lang] || 0;
        list.append(this._row(lang, langName(lang), s.selected === lang, n));
      }
      m.append(list);

      const opts = el("div", "dct-opts");
      opts.append(this._slider("Voz original de fondo", Math.round(this.prefs.backgroundVolume * 100), 0, 60, "%", (v) => this.onprefs && this.onprefs({ backgroundVolume: v / 100 })));
      opts.append(this._slider("Retraso para cuadrar con el video", this.prefs.delaySec, 0, 8, " s", (v) => this.onprefs && this.onprefs({ delaySec: v }), 0.5));
      opts.append(this._toggle("Subtítulos", this.prefs.captions, (v) => { this.onprefs && this.onprefs({ captions: v }); }));
      opts.append(this._toggle("Mostrar también lo que dijo", this.prefs.captionSource, (v) => { this.onprefs && this.onprefs({ captionSource: v }); }));
      m.append(opts);

      const foot = el("div", "dct-foot");
      const a = el("a", null, "Decatron Translate");
      a.href = "https://decatron.net/translate"; a.target = "_blank"; a.rel = "noreferrer";
      foot.append(a);
      m.append(foot);
    }

    _row(lang, label, selected, listeners) {
      const r = el("button", "dct-row" + (selected ? " dct-selected" : ""));
      r.setAttribute("role", "menuitemradio");
      r.setAttribute("aria-checked", String(selected));
      r.append(el("span", "dct-check", selected ? "✓" : ""));
      r.append(el("span", "dct-row-label", label));
      if (listeners != null && listeners > 0) r.append(el("span", "dct-row-meta", listeners === 1 ? "1 oyente" : `${listeners} oyentes`));
      r.addEventListener("click", () => { this.onselect && this.onselect(lang); this.closeMenu(); });
      return r;
    }

    _slider(label, value, min, max, unit, onchange, step = 1) {
      const w = el("label", "dct-opt");
      const top = el("div", "dct-opt-top");
      const val = el("span", "dct-opt-val", `${value}${unit}`);
      top.append(el("span", null, label), val);
      const input = el("input");
      input.type = "range"; input.min = min; input.max = max; input.step = step; input.value = value;
      input.addEventListener("input", () => { val.textContent = `${input.value}${unit}`; onchange(Number(input.value)); });
      w.append(top, input);
      return w;
    }

    _toggle(label, value, onchange) {
      const w = el("label", "dct-opt dct-opt-row");
      const input = el("input"); input.type = "checkbox"; input.checked = !!value;
      input.addEventListener("change", () => onchange(input.checked));
      w.append(el("span", null, label), input);
      return w;
    }

    applyCaptionPrefs() {
      this.captions.style.setProperty("--dct-cap-size", (this.prefs.captionSize || 22) + "px");
      this.captionSource.hidden = !this.prefs.captionSource;
    }

    /** Muestra un segmento; con duración, revela las palabras a ritmo del audio. */
    showCaption(meta, durationSec) {
      if (this._capTimer) { clearInterval(this._capTimer); this._capTimer = null; }
      if (!meta || !this.prefs.captions) { this.captions.hidden = true; return; }
      this.ensureMounted();
      this.captionSource.textContent = meta.source || "";
      const words = (meta.text || "").split(/\s+/).filter(Boolean);
      this.captionText.textContent = "";
      // Frases largas: letra un poco menor para que quepan en dos o tres líneas.
      this.captions.classList.toggle("dct-long", (meta.text || "").length > 90);
      const spans = words.map((w) => { const s = el("span", "dct-w", w + " "); this.captionText.append(s); return s; });
      this.captions.hidden = false;
      if (!durationSec || words.length === 0) { spans.forEach((s) => s.classList.add("dct-on")); return; }
      // Sin tiempos por palabra del TTS: se reparten uniformes, y se deja el último 15 % de margen.
      const per = (durationSec * 0.85 * 1000) / words.length;
      let i = 0;
      spans[0].classList.add("dct-on"); i = 1;
      this._capTimer = setInterval(() => {
        if (i >= spans.length) { clearInterval(this._capTimer); this._capTimer = null; return; }
        spans[i++].classList.add("dct-on");
      }, per);
    }

    destroy() {
      document.removeEventListener("click", this._outside);
      document.removeEventListener("keydown", this._esc);
      this.wrap.remove(); this.menu.remove(); this.captions.remove(); this.toast.remove();
    }
  }

  window.__decatronPlayerUi = PlayerUi;
  window.__decatronLangName = langName;
})();
