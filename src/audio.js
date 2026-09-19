// Reproducción de los segmentos traducidos y control del volumen del player de Twitch.
//
// Cada segmento llega en trozos MP3 (SegmentStart → SegmentChunk* → SegmentEnd). Se
// decodifica completo con decodeAudioData y se encola: los segmentos suenan en orden y
// nunca encimados. Mientras suena uno, el <video> de Twitch baja al "volumen de fondo";
// cuando no hay nada en cola vuelve a su volumen (ducking inverso), así el juego se oye
// cuando el streamer calla.
(function () {
  class TranslationPlayer {
    constructor(video) {
      this.video = video;
      this.ctx = null;
      this.gain = null;
      this.queue = [];          // { seq, buffer, text, source }
      this.playing = null;
      this.chunks = new Map();  // seq -> { parts: [], meta }
      this.backgroundVolume = 0.15;
      this.delaySec = 0;        // retraso extra para cuadrar con el video
      this.userVolume = video ? video.volume : 1;
      this.onsegment = null;    // (meta|null, durationSec) → subtítulos
      this.onaudioblocked = null; // (bool) el navegador no deja sonar hasta un gesto del usuario
      this._ducked = false;
      this._rampTimer = null;
      this._muted = false;
    }

    async ensureContext() {
      if (!this.ctx) {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.gain = this.ctx.createGain();
        this.gain.connect(this.ctx.destination);
        this.ctx.onstatechange = () => {
          const running = this.ctx && this.ctx.state === "running";
          this.onaudioblocked && this.onaudioblocked(!running);
          if (running) this._pump();
        };
        // Chrome solo deja sonar un AudioContext creado/reanudado tras un gesto del
        // usuario. Si la extensión se unió sola (idioma recordado), cualquier clic o
        // tecla en la página sirve para desbloquearlo.
        const unlock = () => { if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {}); };
        for (const ev of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, unlock, { capture: true, passive: true });
        this._unlock = unlock;
      }
      if (this.ctx.state !== "running") { try { await this.ctx.resume(); } catch {} }
      this.onaudioblocked && this.onaudioblocked(this.ctx.state !== "running");
      return this.ctx.state === "running";
    }

    get isBlocked() { return !!this.ctx && this.ctx.state !== "running"; }

    setOutputVolume(v) { if (this.gain) this.gain.gain.value = v; this._outVol = v; }

    start(meta) { this.chunks.set(meta.seq, { parts: [], meta }); }

    chunk(seq, b64) {
      const e = this.chunks.get(seq);
      if (!e) return;
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      e.parts.push(arr);
    }

    async end(seq, error) {
      const e = this.chunks.get(seq);
      this.chunks.delete(seq);
      if (!e) return;
      if (error || e.parts.length === 0) {
        // Sin audio: al menos el subtítulo, un rato proporcional al texto.
        this._showOnly(e.meta);
        return;
      }
      await this.ensureContext();
      const total = e.parts.reduce((n, p) => n + p.length, 0);
      const joined = new Uint8Array(total);
      let off = 0;
      for (const p of e.parts) { joined.set(p, off); off += p.length; }
      let buffer;
      try { buffer = await this.ctx.decodeAudioData(joined.buffer); }
      catch { this._showOnly(e.meta); return; }
      this.queue.push({ seq, buffer, meta: e.meta });
      this.queue.sort((a, b) => a.seq - b.seq);
      this._pump();
    }

    dropped(seq) { this.chunks.delete(seq); this.queue = this.queue.filter(q => q.seq !== seq); }

    _showOnly(meta) {
      const secs = Math.min(6, Math.max(1.5, (meta.text || "").length / 14));
      this.onsegment && this.onsegment(meta, secs);
      setTimeout(() => { if (!this.playing) this.onsegment && this.onsegment(null, 0); }, secs * 1000);
    }

    _pump() {
      if (this.playing || this.queue.length === 0) return;
      if (!this.ctx || this.ctx.state !== "running") {
        // Sin audio desbloqueado no se encola nada: se muestra el subtítulo y se avisa.
        const item = this.queue.shift();
        this.onaudioblocked && this.onaudioblocked(true);
        this._showOnly(item.meta);
        return;
      }
      const item = this.queue.shift();
      this.playing = item;
      const src = this.ctx.createBufferSource();
      src.buffer = item.buffer;
      src.connect(this.gain);
      const when = this.ctx.currentTime + Math.max(0, this.delaySec);
      const startInMs = Math.max(0, this.delaySec) * 1000;
      setTimeout(() => {
        if (this.playing !== item) return;
        this._duck(true);
        this.onsegment && this.onsegment(item.meta, item.buffer.duration);
      }, startInMs);
      src.onended = () => {
        if (this.playing === item) this.playing = null;
        src.disconnect();
        if (this.queue.length === 0) {
          // Pequeño colchón: si viene otra frase enseguida no subir/bajar el original a cada rato.
          this._rampTimer = setTimeout(() => { if (!this.playing && this.queue.length === 0) { this._duck(false); this.onsegment && this.onsegment(null, 0); } }, 400);
        } else this._pump();
      };
      if (this._rampTimer) { clearTimeout(this._rampTimer); this._rampTimer = null; }
      src.start(when);
      this._current = src;
    }

    _duck(on) {
      if (!this.video) return;
      if (on && !this._ducked) { this.userVolume = this.video.volume; this._ducked = true; }
      const target = on ? Math.min(this.userVolume, this.backgroundVolume) : this.userVolume;
      this._rampTo(target, 250);
      if (!on) this._ducked = false;
    }

    // El player no expone una rampa; se hace a mano en ~12 pasos.
    _rampTo(target, ms) {
      const v = this.video;
      const from = v.volume;
      const steps = 12;
      let i = 0;
      const id = setInterval(() => {
        i++;
        v.volume = Math.max(0, Math.min(1, from + (target - from) * (i / steps)));
        if (i >= steps) clearInterval(id);
      }, ms / steps);
    }

    /** El usuario cambió el volumen de Twitch con la app en marcha: respetarlo como nuevo base. */
    noteUserVolume() { if (!this._ducked && this.video) this.userVolume = this.video.volume; }

    stop() {
      this.queue = [];
      this.chunks.clear();
      try { this._current && this._current.stop(); } catch {}
      this.playing = null;
      if (this._ducked) this._duck(false);
      this.onsegment && this.onsegment(null, 0);
    }

    destroy() {
      this.stop();
      if (this._unlock) for (const ev of ["pointerdown", "keydown", "touchstart"]) document.removeEventListener(ev, this._unlock, { capture: true });
      if (this.ctx) { try { this.ctx.close(); } catch {} this.ctx = null; }
    }
  }

  window.__decatronPlayer = TranslationPlayer;
})();
