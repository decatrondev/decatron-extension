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
      // Control de atraso: si la cola crece (el streamer habla seguido) se acelera un
      // poco y, pasado un límite, se descartan las frases más viejas (quedan como
      // subtítulo). Mejor perder una frase que ir un minuto detrás del video.
      this.maxBacklogSec = 6;
      this.speedUpAboveSec = 2.5;
      this.fastRate = 1.15;
      this.stats = { played: 0, dropped: 0, lastDelay: 0 };
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
          if (!this.ctx) return;
          const st = this.ctx.state;
          console.info("[decatron] AudioContext cambió a:", st);
          if (st === "closed") return;                 // lo cerramos nosotros al desmontar
          this.onaudioblocked && this.onaudioblocked(st !== "running", st !== "running" ? "estado " + st : undefined);
          if (st === "running") this._pump();
        };
        // Chrome solo deja sonar un AudioContext creado/reanudado tras un gesto del
        // usuario. Si la extensión se unió sola (idioma recordado), cualquier clic o
        // tecla en la página sirve para desbloquearlo.
        const unlock = () => { if (this.ctx && this.ctx.state !== "running") this.ctx.resume().catch(() => {}); };
        for (const ev of ["pointerdown", "keydown", "touchstart"]) document.addEventListener(ev, unlock, { capture: true, passive: true });
        this._unlock = unlock;
      }
      if (this.ctx.state !== "running") {
        try { await this.ctx.resume(); }
        catch (e) { console.info("[decatron] AudioContext.resume falló:", e && e.name, e && e.message); }
      }
      console.info("[decatron] AudioContext:", this.ctx.state, "sampleRate", this.ctx.sampleRate, "sink", this.ctx.sinkId === undefined ? "n/d" : (this.ctx.sinkId || "default"));
      const running = this.ctx.state === "running";
      // Si Web Audio no arranca se reproduce con <audio>; el aviso solo si eso también falla.
      this.useElement = !running;
      if (running) this.onaudioblocked && this.onaudioblocked(false);
      return running;
    }

    get isBlocked() { return !!this.ctx && this.ctx.state !== "running"; }

    /**
     * Llamar dentro de un clic del usuario. Reanuda el AudioContext y reproduce un
     * <audio> silencioso: con eso la pestaña queda autorizada para sonar aunque el
     * navegador tuviera bloqueado el autoplay para twitch.tv. Devuelve null si todo
     * quedó bien o el nombre del error para mostrarlo.
     */
    async unlock() {
      let err = null;
      const ok = await this.ensureContext();
      if (!ok) {
        try {
          // 0,1 s de silencio WAV, suficiente para pedir permiso de reproducción.
          const a = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=");
          await a.play();
          this.useElement = true;
          console.info("[decatron] <audio> autorizado; se usará esa vía");
        } catch (e) {
          err = (e && e.name) || "error";
          console.info("[decatron] desbloqueo falló:", err, e && e.message);
        }
      }
      this.onaudioblocked && this.onaudioblocked(!ok && !!err, err);
      if (this.queue.length) (this.useElement ? this._pumpElement() : this._pump());
      return err;
    }

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
      const running = await this.ensureContext();
      const total = e.parts.reduce((n, p) => n + p.length, 0);
      const joined = new Uint8Array(total);
      let off = 0;
      for (const p of e.parts) { joined.set(p, off); off += p.length; }
      if (!running) {
        this.queue.push({ seq, blob: new Blob([joined], { type: "audio/mpeg" }), meta: e.meta });
        this.queue.sort((a, b) => a.seq - b.seq);
        this._pumpElement();
        return;
      }
      let buffer;
      try { buffer = await this.ctx.decodeAudioData(joined.buffer); }
      catch (err) { console.info("[decatron] decodeAudioData falló:", err && err.message, "bytes:", total); this._showOnly(e.meta); return; }
      console.info(`[decatron] seg ${seq}: ${total} bytes → ${buffer.duration.toFixed(2)}s de audio; ctx=${this.ctx.state}; en cola=${this.queue.length}; reproduciendo=${this.playing ? this.playing.seq : "-"}`);
      this.queue.push({ seq, buffer, meta: e.meta, arrivedAt: performance.now() });
      this.queue.sort((a, b) => a.seq - b.seq);
      this._trimBacklog();
      this._pump();
    }

    dropped(seq) { this.chunks.delete(seq); this.queue = this.queue.filter(q => q.seq !== seq); }

    _backlogSec() { return this.queue.reduce((n, q) => n + (q.buffer ? q.buffer.duration : 2), 0); }

    _trimBacklog() {
      while (this.queue.length > 1 && this._backlogSec() > this.maxBacklogSec) {
        const old = this.queue.shift();
        this.stats.dropped++;
        console.info(`[decatron] ✂ seg ${old.seq} descartado por atraso (cola ${this._backlogSec().toFixed(1)}s)`);
        this.onsegment && this.onsegment(old.meta, 0.8);
      }
    }

    _showOnly(meta) {
      const secs = Math.min(6, Math.max(1.5, (meta.text || "").length / 14));
      this.onsegment && this.onsegment(meta, secs);
      setTimeout(() => { if (!this.playing) this.onsegment && this.onsegment(null, 0); }, secs * 1000);
    }

    _pump() {
      if (this.playing || this.queue.length === 0) return;
      if (!this.ctx || this.ctx.state !== "running") { this._pumpElement(); return; }
      if (this.queue[0].blob) { this._pumpElement(); return; }
      const item = this.queue.shift();
      this.playing = item;
      const src = this.ctx.createBufferSource();
      src.buffer = item.buffer;
      const backlog = this._backlogSec();
      src.playbackRate.value = backlog > this.speedUpAboveSec ? this.fastRate : 1;
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
      this.onaudioblocked && this.onaudioblocked(false); // está sonando de verdad: sin aviso
      const waited = item.arrivedAt ? (performance.now() - item.arrivedAt) / 1000 : 0;
      const sinceStt = item.meta.sttAt ? (Date.now() - new Date(item.meta.sttAt).getTime()) / 1000 : null;
      this.stats.played++; this.stats.lastDelay = sinceStt;
      const sttLag = item.meta.sttLag;
      const streamLag = item.meta.streamLag;
      console.info(`[decatron] ▶ seg ${item.seq} (${item.buffer.duration.toFixed(2)}s, x${src.playbackRate.value}) app→servidor atraso ${streamLag == null ? "n/d" : streamLag.toFixed(1) + "s"}; STT cerró ${sttLag == null ? "n/d" : sttLag.toFixed(1) + "s"} tras callar; servidor→aquí ${sinceStt == null ? "n/d" : sinceStt.toFixed(1) + "s"}; cola ${waited.toFixed(1)}s`);

    }

    // Vía alternativa: un <audio> por segmento. Misma cola, mismo ducking. Se usa cuando
    // el AudioContext no arranca (política de autoplay) — el elemento sí suele poder.
    _pumpElement() {
      if (this.playing || this.queue.length === 0) return;
      const item = this.queue.shift();
      if (!item.blob) {
        // Venía decodificado para Web Audio; sin contexto no se puede usar. Subtítulo y seguir.
        this._showOnly(item.meta);
        return;
      }
      this.playing = item;
      const url = URL.createObjectURL(item.blob);
      const a = new Audio(url);
      a.preload = "auto";
      this._currentEl = a;
      const finish = () => {
        URL.revokeObjectURL(url);
        if (this.playing === item) this.playing = null;
        if (this.queue.length === 0) {
          this._rampTimer = setTimeout(() => { if (!this.playing && this.queue.length === 0) { this._duck(false); this.onsegment && this.onsegment(null, 0); } }, 400);
        } else this._pumpElement();
      };
      a.onended = finish;
      a.onerror = () => { console.warn("[decatron] <audio> error", a.error && a.error.code); finish(); };
      const go = () => {
        a.play().then(() => {
          this.onaudioblocked && this.onaudioblocked(false);
          this._duck(true);
          this.onsegment && this.onsegment(item.meta, a.duration || (item.meta.text || "").length / 14);
        }).catch((e) => {
          console.info("[decatron] <audio>.play falló:", e && e.name, e && e.message);
          this.onaudioblocked && this.onaudioblocked(true, e && e.name);
          this._showOnly(item.meta);
          finish();
        });
      };
      if (this.delaySec > 0) setTimeout(go, this.delaySec * 1000); else go();
      if (this._rampTimer) { clearTimeout(this._rampTimer); this._rampTimer = null; }
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
      try { if (this._currentEl) { this._currentEl.pause(); this._currentEl.src = ""; } } catch {}
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
