// Subtítulos y aviso de audio bloqueado sobre el video del player (módulo de traducción).
// Los estilos están en player.css con el prefijo dct- para no chocar con los de Twitch.
(function () {
  const D = window.__decatron;
  const { t } = D;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  class CaptionsUi {
    /** @param {HTMLElement} playerRoot contenedor del player */
    constructor(playerRoot, prefs) {
      this.prefs = prefs;
      this.root = playerRoot;
      this.rootProvider = null;   // () => contenedor actual del player; Twitch lo reemplaza al re-renderizar
      this.selected = null;       // idioma elegido (el aviso solo se ve si hay uno)
      this.onunlock = null;

      // Aviso de audio bloqueado (Chrome exige un gesto para sonar)
      this.toast = el("div", "dct-toast");
      this.toast.hidden = true;
      this.toastText = el("span", null, t("tr.audioBlocked"));
      this.toast.append(this.toastText);
      const unlockBtn = el("button", "dct-toast-btn", t("tr.unlock"));
      unlockBtn.addEventListener("click", (e) => { e.stopPropagation(); e.preventDefault(); this.onunlock && this.onunlock(); });
      unlockBtn.addEventListener("pointerup", (e) => e.stopPropagation());
      unlockBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
      this.toast.append(unlockBtn);
      playerRoot.appendChild(this.toast);

      // Subtítulos
      this.captions = el("div", "dct-captions");
      this.captions.hidden = true;
      this.captionSource = el("div", "dct-cap-src");
      this.captionText = el("div", "dct-cap-text");
      this.captions.append(this.captionSource, this.captionText);
      playerRoot.appendChild(this.captions);
      this.applyCaptionPrefs();
    }

    setAudioBlocked(blocked, reason) {
      if (blocked) this.ensureMounted();
      this.toastText.textContent = reason ? t("tr.audioBlockedWhy", { reason }) : t("tr.audioBlocked");
      this.toast.hidden = !blocked || !this.selected;
    }

    /** Twitch vuelve a crear el contenedor del player: si nuestros nodos quedaron en el viejo, moverlos al nuevo. */
    ensureMounted() {
      const fresh = this.rootProvider && this.rootProvider();
      if (fresh && fresh !== this.root) this.root = fresh;
      if (!this.root || !document.contains(this.root)) return false;
      for (const n of [this.toast, this.captions]) if (!this.root.contains(n)) this.root.appendChild(n);
      return true;
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
      if (this._capTimer) clearInterval(this._capTimer);
      this.captions.remove();
      this.toast.remove();
    }
  }

  window.__decatronCaptionsUi = CaptionsUi;
})();
