// Procesamiento de audio y tiempos de la traducción, sin tocar el DOM (se prueba en Node con test/dsp.test.mjs).
//  - wsola: acelera la voz sin subirle el tono (con playbackRate la voz suena "ardilla").
//  - voicedSpan / wordTimings: reparte las palabras del subtítulo según cuándo suena realmente la voz.
//  - rateForAhead: cuánto acelerar según el audio que queda por delante (modo alcance).
(function () {
  /**
   * Time-scale modification por WSOLA (waveform similarity overlap-add): toma tramos de ~25 ms
   * avanzando más rápido por la entrada que por la salida y elige, cerca de cada posición, el
   * corte que mejor continúa la onda anterior. Vale para voz a 1.05x-1.5x.
   * @param {Float32Array} x muestras mono
   * @param {number} sr frecuencia de muestreo
   * @param {number} rate 1 = igual, 1.2 = 20 % más rápido
   * @returns {Float32Array} copia más corta (≈ x.length / rate)
   */
  function wsola(x, sr, rate) {
    if (!(rate > 1.001) || x.length < sr * 0.1) return x.slice();
    const N = 2 * Math.round(sr * 0.0125);        // tramo ≈ 25 ms (par)
    const Hs = N / 2;                              // avance en la salida: 50 % de solape
    const Ha = Hs * rate;                          // avance nominal en la entrada
    const delta = Math.round(sr * 0.008);          // búsqueda ±8 ms
    const outLen = Math.floor(x.length / rate);
    const out = new Float32Array(outLen + N);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);   // Hann periódica: a 50 % suma 1
    const pad = new Float32Array(x.length + N + 2 * delta + Hs);
    pad.set(x);

    // Primer tramo: la primera mitad pasa tal cual (sin fundido de entrada).
    for (let i = 0; i < Hs; i++) out[i] = x[i];
    for (let i = Hs; i < N; i++) out[i] = x[i] * win[i];
    let prev = 0;
    for (let k = 1; ; k++) {
      const outPos = k * Hs;
      if (outPos >= outLen) break;
      const nominal = Math.round(k * Ha);
      if (nominal - delta >= x.length) break;
      const tmpl = prev + Hs;                      // por dónde seguiría la onda anterior
      const lo = Math.max(0, nominal - delta), hi = nominal + delta;
      let best = Math.min(Math.max(nominal, 0), x.length), bestScore = -Infinity;
      for (let p = lo; p <= hi; p++) {
        let s = 0, e = 1e-9;
        for (let i = 0; i < Hs; i += 2) { const a = pad[p + i]; s += pad[tmpl + i] * a; e += a * a; }
        const score = s / Math.sqrt(e);            // correlación normalizada: no favorece los tramos fuertes
        if (score > bestScore) { bestScore = score; best = p; }
      }
      for (let i = 0; i < N; i++) out[outPos + i] += pad[best + i] * win[i];
      prev = best;
    }
    return out.subarray(0, outLen);
  }

  /** Tramo donde suena la voz (en segundos), quitando el silencio de los extremos. */
  function voicedSpan(x, sr) {
    const dur = x.length / sr;
    const frame = Math.max(1, Math.round(sr * 0.01));
    const n = Math.floor(x.length / frame);
    if (n < 3) return { start: 0, end: dur };
    const rms = new Float32Array(n);
    let peak = 0;
    for (let f = 0; f < n; f++) {
      let s = 0;
      for (let i = f * frame; i < (f + 1) * frame; i++) s += x[i] * x[i];
      rms[f] = Math.sqrt(s / frame);
      if (rms[f] > peak) peak = rms[f];
    }
    if (peak < 1e-4) return { start: 0, end: dur };
    const thr = peak * 0.08;
    let a = 0, b = n - 1;
    while (a < n && rms[a] < thr) a++;
    while (b > a && rms[b] < thr) b--;
    return { start: (a * frame) / sr, end: Math.min(dur, ((b + 1) * frame) / sr) };
  }

  /**
   * Cuándo empieza cada palabra (segundos desde el inicio del audio). Se reparte por el peso de
   * cada palabra (sus letras) más una pausa tras coma o punto, dentro del tramo en que suena la voz.
   */
  function wordTimings(text, span) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    if (words.length === 0) return [];
    const weights = words.map((w) => {
      const letters = w.replace(/[^\p{L}\p{N}]/gu, "").length;
      let pause = 0;
      if (/[,;:，、]$/.test(w)) pause = 2;
      else if (/[.?!…。？！]$/.test(w)) pause = 4;
      return { w: Math.max(1, letters), pause };
    });
    const total = weights.reduce((n, x) => n + x.w + x.pause, 0);
    const len = Math.max(0.1, span.end - span.start);
    const out = [];
    let acc = 0;
    for (const x of weights) { out.push(span.start + (acc / total) * len); acc += x.w + x.pause; }
    return out;
  }

  /**
   * Valores de fábrica del modo alcance y de la interfaz. El servidor puede mandar otros (así se afinan
   * sin publicar una versión en las tiendas); lo que llegue pasa por sanitizeTuning y, si algo no cuadra,
   * se usa el valor de fábrica de ese campo. Solo datos: nada de lo que mande el servidor se ejecuta.
   */
  const DEFAULT_TUNING = Object.freeze({
    aheadThresholds: [1.2, 2.5, 4.5],
    rates: [1, 1.1, 1.18, 1.25],
    maxBacklogSec: 8,
    silentAfterSec: 25,
    readCharsPerSec: 15,
    readMinSec: 1.2,
    readMaxSec: 8,
    historyMax: 30,
  });

  /** Acepta lo que mande el servidor (camelCase) y devuelve siempre un objeto completo y dentro de límites. */
  function sanitizeTuning(raw) {
    const d = DEFAULT_TUNING;
    const r = raw && typeof raw === "object" ? raw : {};
    const num = (v, lo, hi, fb) => (typeof v === "number" && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fb);
    const arr = (v, n) => Array.isArray(v) && v.length === n && v.every((x) => typeof x === "number" && isFinite(x));
    const th = arr(r.aheadThresholds, 3) && r.aheadThresholds.every((x) => x > 0 && x < 60) && r.aheadThresholds[0] < r.aheadThresholds[1] && r.aheadThresholds[1] < r.aheadThresholds[2]
      ? r.aheadThresholds.slice() : d.aheadThresholds.slice();
    const rates = arr(r.rates, 4) && r.rates.every((x) => x >= 1 && x <= 1.5) && r.rates[0] <= r.rates[1] && r.rates[1] <= r.rates[2] && r.rates[2] <= r.rates[3]
      ? r.rates.slice() : d.rates.slice();
    const readMin = num(r.readMinSec, 0.5, 5, d.readMinSec);
    return {
      aheadThresholds: th,
      rates,
      maxBacklogSec: num(r.maxBacklogSec, 3, 30, d.maxBacklogSec),
      silentAfterSec: Math.round(num(r.silentAfterSec, 10, 180, d.silentAfterSec)),
      readCharsPerSec: num(r.readCharsPerSec, 8, 40, d.readCharsPerSec),
      readMinSec: readMin,
      readMaxSec: num(r.readMaxSec, readMin, 20, d.readMaxSec),
      historyMax: Math.round(num(r.historyMax, 5, 100, d.historyMax)),
    };
  }

  /**
   * Modo alcance: cuánto acelerar según los segundos de audio que quedan por delante (lo que suena
   * más lo que espera). Escalonado y suave: hasta 1.25x, que con WSOLA todavía se entiende bien.
   */
  function rateForAhead(aheadSec, tuning) {
    const t = tuning && Array.isArray(tuning.aheadThresholds) ? tuning : DEFAULT_TUNING;
    for (let i = 0; i < t.aheadThresholds.length; i++) if (aheadSec <= t.aheadThresholds[i]) return t.rates[i];
    return t.rates[t.rates.length - 1];
  }

  /** Duración para mostrar un subtítulo sin audio: ritmo de lectura cómodo, más rápido si hay cola. */
  function readSeconds(text, aheadSec, tuning) {
    const t = tuning && typeof tuning.readCharsPerSec === "number" ? tuning : DEFAULT_TUNING;
    const base = Math.min(t.readMaxSec, Math.max(t.readMinSec, String(text || "").length / t.readCharsPerSec));
    return base / rateForAhead(aheadSec || 0, t);
  }

  window.__decatronDsp = { wsola, voicedSpan, wordTimings, rateForAhead, readSeconds, sanitizeTuning, DEFAULT_TUNING };
})();
