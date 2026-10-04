// Selector de emotes con ":" sobre la caja de escritura del chat de Twitch (un editor Slate).
// Al escribir ":" y las primeras letras aparece una lista; con Enter, Tab o un clic se inserta el nombre del emote.
(function () {
  const D = window.__decatron;
  const { h } = D;
  const INPUT = '[data-a-target="chat-input"]';
  const TOKEN = /(?:^|\s):([A-Za-z0-9_]{2,})$/;
  const MAX_ITEMS = 8;

  class EmotePicker {
    /** @param {() => Array<{n:string,u:string,p:string}>} getEntries */
    constructor(getEntries) {
      this.getEntries = getEntries;
      this.input = null;
      this.items = [];
      this.index = 0;
      this.token = null;
      this.dismissed = null;   // el ":algo" que se cerró con Escape: no se vuelve a abrir hasta que cambie
      this.host = null;
      this.timer = null;
      this._onInput = () => this.update();
      this._onKeyDown = (e) => this.keydown(e);
      this._onBlur = () => setTimeout(() => this.hide(), 150);
    }

    start() { this.timer = setInterval(() => this.attach(), 1000); this.attach(); }

    stop() {
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      this.detach();
      this.hide();
    }

    attach() {
      const input = document.querySelector(INPUT);
      if (input === this.input) return;
      this.detach();
      if (!input) return;
      this.input = input;
      input.addEventListener("input", this._onInput);
      input.addEventListener("keyup", this._onInput);
      input.addEventListener("click", this._onInput);
      // En fase de captura: Enter/Tab/flechas son nuestras mientras la lista está abierta, antes de que Twitch los vea
      input.addEventListener("keydown", this._onKeyDown, true);
      input.addEventListener("blur", this._onBlur);
    }

    detach() {
      const input = this.input;
      if (!input) return;
      input.removeEventListener("input", this._onInput);
      input.removeEventListener("keyup", this._onInput);
      input.removeEventListener("click", this._onInput);
      input.removeEventListener("keydown", this._onKeyDown, true);
      input.removeEventListener("blur", this._onBlur);
      this.input = null;
    }

    /** El ":algo" que está justo antes del cursor, o null */
    currentToken() {
      const sel = window.getSelection();
      if (!this.input || !sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
      const node = sel.anchorNode;
      if (!node || node.nodeType !== Node.TEXT_NODE || !this.input.contains(node)) return null;
      const before = node.textContent.slice(0, sel.anchorOffset);
      const m = TOKEN.exec(before);
      return m ? { node, offset: sel.anchorOffset, query: m[1] } : null;
    }

    update() {
      const token = this.currentToken();
      if (!token) { this.dismissed = null; this.hide(); return; }
      const key = token.query + "@" + token.offset;
      if (key === this.dismissed) { this.hide(); return; }
      this.dismissed = null;
      const q = token.query.toLowerCase();
      const scored = [];
      for (const e of this.getEntries()) {
        const name = e.n.toLowerCase();
        const at = name.indexOf(q);
        if (at < 0) continue;
        // Primero los que empiezan igual, después los propios de Decatron, después por largo
        scored.push({ e, score: (at === 0 ? 0 : 100) + (e.p === "own" ? 0 : 10) + e.n.length / 100 });
      }
      scored.sort((a, b) => a.score - b.score);
      this.items = scored.slice(0, MAX_ITEMS).map((s) => s.e);
      if (this.items.length === 0) { this.hide(); return; }
      this.token = token;
      this.index = Math.min(this.index, this.items.length - 1);
      this.render();
    }

    keydown(e) {
      if (!this.host || this.items.length === 0) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation();
        this.index = (this.index + (e.key === "ArrowDown" ? 1 : -1) + this.items.length) % this.items.length;
        this.render();
      } else if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault(); e.stopPropagation();
        this.accept(this.items[this.index]);
      } else if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation();
        if (this.token) this.dismissed = this.token.query + "@" + this.token.offset;
        this.hide();
      }
    }

    /**
     * Cambia el ":algo" por "Nombre " con el mismo camino que usa el teclado, para que el editor se entere.
     * El editor de Twitch (Slate) se entera de la selección con un evento asíncrono: hay que dejarlo ver el
     * ":algo" seleccionado antes de insertar, si no el texto cae donde él cree que está el cursor.
     */
    async accept(entry) {
      // El token se vuelve a leer ahora: React redibuja los nodos de texto del editor mientras se escribe
      const token = this.currentToken() || this.token;
      const input = this.input;
      this.hide();
      if (!entry || !token || !input) { console.info("[decatron] selector: sin token", !!entry, !!token, !!input); return; }
      const sel = window.getSelection();
      const range = document.createRange();
      range.setStart(token.node, token.offset - (token.query.length + 1));
      range.setEnd(token.node, token.offset);
      input.focus();
      sel.removeAllRanges();
      sel.addRange(range);
      await new Promise((r) => setTimeout(r, 120));
      // Si mientras tanto el usuario movió el cursor, no se inserta nada
      if (!input.isConnected || sel.rangeCount === 0 || sel.toString() !== ":" + token.query) return;
      const text = entry.n + " ";
      // El editor (Slate) atiende "beforeinput" y reemplaza lo seleccionado; execCommand no lo toca (se probó contra Slate real)
      input.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: text, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 120));
      // Si el editor ignoró el evento, se prueba pegando el texto: es otro camino que Slate también maneja
      if (input.isConnected && input.textContent.includes(":" + token.query)) {
        const data = new DataTransfer();
        data.setData("text/plain", text);
        const range = document.createRange();
        range.setStart(token.node, token.offset - (token.query.length + 1));
        range.setEnd(token.node, token.offset);
        if (token.node.isConnected) { sel.removeAllRanges(); sel.addRange(range); }
        input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
      }
    }

    render() {
      if (!this.input) return;
      if (!this.host) {
        this.host = h("div", { id: "decatron-picker" });
        const root = this.host.attachShadow({ mode: "open" });
        root.append(h("style", null, PICKER_CSS), h("div", { class: "box", role: "listbox" }));
        document.body.append(this.host);
      }
      const box = this.host.shadowRoot.querySelector(".box");
      box.textContent = "";
      this.items.forEach((e, i) => {
        const row = h("div", { class: "item" + (i === this.index ? " on" : ""), role: "option", "aria-selected": String(i === this.index) },
          h("img", { src: e.u, alt: "", draggable: "false" }), h("span", { class: "name" }, e.n), h("span", { class: "tag" }, D.t("em.provider." + e.p)));
        // mousedown y no click: el clic le quitaría el foco a la caja antes de insertar
        row.addEventListener("mousedown", (ev) => { ev.preventDefault(); this.index = i; this.accept(e); });
        box.append(row);
      });
      const r = this.input.getBoundingClientRect();
      this.host.style.left = Math.max(8, r.left) + "px";
      this.host.style.width = Math.min(Math.max(220, r.width), 320) + "px";
      this.host.style.bottom = Math.max(8, window.innerHeight - r.top + 6) + "px";
    }

    hide() {
      this.items = [];
      this.index = 0;
      this.token = null;
      if (this.host) { this.host.remove(); this.host = null; }
    }
  }

  const PICKER_CSS = `
    .box { font-family: "Inter", "Roobert", "Segoe UI", system-ui, sans-serif; font-size: 13px; background: #18181b; color: #efeff1; border: 1px solid #3a3a3d; border-radius: 8px;
      box-shadow: 0 8px 28px rgba(0,0,0,.5); padding: 4px; max-height: 320px; overflow: hidden; }
    .item { display: flex; align-items: center; gap: 10px; padding: 5px 8px; border-radius: 6px; cursor: pointer; }
    .item.on, .item:hover { background: #9146ff; }
    .item img { height: 28px; width: auto; max-width: 56px; object-fit: contain; flex-shrink: 0; }
    .name { flex: 1; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tag { font-size: 10px; font-weight: 700; padding: 1px 6px; border-radius: 999px; background: rgba(255,255,255,.14); }
  `;

  window.__decatronEmotePicker = EmotePicker;
})();
