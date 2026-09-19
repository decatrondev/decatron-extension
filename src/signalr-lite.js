// Cliente SignalR mínimo (protocolo JSON sobre WebSocket, sin negotiate).
// Solo lo que la extensión necesita: invocar un método con resultado, recibir
// mensajes del servidor, ping y reconexión. Evita cargar la librería oficial
// (~200 KB) dentro de cada pestaña de Twitch.
(function () {
  const SEP = "\x1e";

  class SignalRLite {
    constructor(url) {
      this.url = url;
      this.ws = null;
      this.handlers = new Map();
      this.pending = new Map();
      this.nextId = 1;
      this.state = "disconnected";
      this.onstate = null;
      this._closedByUser = false;
      this._backoff = 1000;
      this._pingTimer = null;
    }

    on(method, fn) {
      if (!this.handlers.has(method)) this.handlers.set(method, []);
      this.handlers.get(method).push(fn);
    }

    _setState(s) {
      if (this.state === s) return;
      this.state = s;
      this.onstate && this.onstate(s);
    }

    connect() {
      this._closedByUser = false;
      return new Promise((resolve, reject) => {
        this._setState("connecting");
        const ws = new WebSocket(this.url);
        this.ws = ws;
        let handshook = false;
        ws.onopen = () => ws.send(JSON.stringify({ protocol: "json", version: 1 }) + SEP);
        ws.onmessage = (ev) => {
          const parts = String(ev.data).split(SEP).filter(Boolean);
          for (const raw of parts) {
            let msg;
            try { msg = JSON.parse(raw); } catch { continue; }
            if (!handshook) {
              handshook = true;
              if (msg.error) { reject(new Error(msg.error)); ws.close(); return; }
              this._backoff = 1000;
              this._setState("connected");
              this._startPing();
              resolve();
              continue;
            }
            this._dispatch(msg);
          }
        };
        ws.onerror = () => { if (!handshook) reject(new Error("ws error")); };
        ws.onclose = () => {
          this._stopPing();
          for (const [, p] of this.pending) p.reject(new Error("closed"));
          this.pending.clear();
          if (this._closedByUser) { this._setState("disconnected"); return; }
          this._setState("reconnecting");
          setTimeout(() => this.connect().catch(() => {}), this._backoff);
          this._backoff = Math.min(30000, this._backoff * 2);
        };
      });
    }

    _dispatch(msg) {
      switch (msg.type) {
        case 1: { // invocation desde el servidor
          const list = this.handlers.get(msg.target);
          if (list) for (const fn of list) { try { fn(...(msg.arguments || [])); } catch (e) { console.warn("[decatron] handler", e); } }
          break;
        }
        case 3: { // completion
          const p = this.pending.get(msg.invocationId);
          if (!p) break;
          this.pending.delete(msg.invocationId);
          msg.error ? p.reject(new Error(msg.error)) : p.resolve(msg.result);
          break;
        }
        case 7: // close
          this.ws && this.ws.close();
          break;
      }
    }

    invoke(target, ...args) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error("not connected"));
      const id = String(this.nextId++);
      const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
      this.ws.send(JSON.stringify({ type: 1, invocationId: id, target, arguments: args }) + SEP);
      return p;
    }

    send(target, ...args) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(JSON.stringify({ type: 1, target, arguments: args }) + SEP);
    }

    _startPing() {
      this._stopPing();
      this._pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ type: 6 }) + SEP);
      }, 15000);
    }
    _stopPing() { if (this._pingTimer) { clearInterval(this._pingTimer); this._pingTimer = null; } }

    close() {
      this._closedByUser = true;
      this._stopPing();
      if (this.ws) { try { this.ws.close(); } catch {} }
      this.ws = null;
      this._setState("disconnected");
    }
  }

  window.__decatronSignalR = SignalRLite;
})();
