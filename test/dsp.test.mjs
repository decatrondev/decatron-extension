// Pruebas de src/dsp.js (estiramiento de voz, tiempos de subtítulos, escala de velocidad). npm run test:dsp
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const ctx = { window: {}, Math, Float32Array, String, Number, RegExp, Array, Object };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(here, '..', 'src', 'dsp.js'), 'utf8'), ctx);
const D = ctx.window.__decatronDsp;

let fails = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`); if (!ok) fails++; };

const SR = 24000;
const sine = (hz, sec, amp = 0.6) => Float32Array.from({ length: Math.round(SR * sec) }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR));
// Frecuencia por cruces ascendentes por cero
const freq = (x) => { let c = 0; for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) c++; return c / (x.length / SR); };
const peak = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);

// 1) Duración y tono
for (const rate of [1.1, 1.18, 1.25, 1.5]) {
  const x = sine(300, 2.0);
  const y = D.wsola(x, SR, rate);
  const expectLen = x.length / rate;
  check(Math.abs(y.length - expectLen) / expectLen < 0.02, `rate ${rate}: dura ${(y.length / SR).toFixed(3)} s (esperado ${(expectLen / SR).toFixed(3)})`);
  const f = freq(y);
  check(Math.abs(f - 300) < 6, `rate ${rate}: el tono se conserva`, `${f.toFixed(1)} Hz (con playbackRate sería ${(300 * rate).toFixed(0)} Hz)`);
  check(peak(y) < 0.6 * 1.08 && !y.some(Number.isNaN), `rate ${rate}: amplitud sana, sin NaN`, `pico ${peak(y).toFixed(3)}`);
}
// 2) Un tono con frecuencia cambiante (tipo voz) no se parte ni se llena de silencios
{
  const n = SR * 2;
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) { const f = 140 + 60 * Math.sin((2 * Math.PI * 3 * i) / SR); ph += (2 * Math.PI * f) / SR; x[i] = 0.5 * Math.sin(ph) * (0.6 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / SR)); }
  const y = D.wsola(x, SR, 1.25);
  const rmsOf = (a) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
  check(Math.abs(rmsOf(y) - rmsOf(x)) / rmsOf(x) < 0.12, 'energía parecida en una señal tipo voz', `${rmsOf(x).toFixed(3)} → ${rmsOf(y).toFixed(3)}`);
  // sin huecos: ninguna ventana de 20 ms casi muda
  let quiet = 0; const w = SR * 0.02;
  for (let i = 0; i + w < y.length; i += w) if (rmsOf(y.subarray(i, i + w)) < 0.02) quiet++;
  check(quiet <= 1, 'no aparecen huecos de silencio', `ventanas mudas: ${quiet}`);
}
// 3) Casos límite
{
  const x = sine(200, 0.05);
  const y = D.wsola(x, SR, 1.25);
  check(y.length === x.length, 'audio muy corto se devuelve sin tocar');
  const z = D.wsola(sine(200, 1), SR, 1);
  check(z.length === SR, 'rate 1 no cambia la duración');
  const e = D.wsola(new Float32Array(0), SR, 1.25);
  check(e.length === 0, 'entrada vacía no falla');
}
// 4) Velocidad de cálculo: 5 s de voz a 1.25x debe tardar bien menos que el audio
{
  const x = sine(220, 5);
  const t0 = performance.now();
  D.wsola(x, SR, 1.25);
  const ms = performance.now() - t0;
  check(ms < 400, 'calcula 5 s de audio rápido', `${ms.toFixed(0)} ms`);
}
// 5) Tramo con voz: quita silencios de los extremos
{
  const x = new Float32Array(SR * 2);                 // 2 s: 0.5 s mudo, 1 s de tono, 0.5 s mudo
  x.set(sine(300, 1.0), SR * 0.5);
  const s = D.voicedSpan(x, SR);
  check(Math.abs(s.start - 0.5) < 0.03 && Math.abs(s.end - 1.5) < 0.03, 'detecta dónde suena la voz', `${s.start.toFixed(2)}–${s.end.toFixed(2)} s`);
  const mute = D.voicedSpan(new Float32Array(SR), SR);
  check(mute.start === 0 && mute.end === 1, 'audio mudo devuelve todo el tramo');
}
// 6) Tiempos por palabra
{
  const t = D.wordTimings('Hola, esto es una prueba larga de verdad.', { start: 0.2, end: 3.2 });
  const inc = t.every((v, i) => i === 0 || v > t[i - 1]);
  check(t.length === 8 && t[0] === 0.2 && inc && t[7] < 3.2, 'cada palabra con su inicio, creciente y dentro del tramo', t.map((v) => v.toFixed(2)).join(' '));
  const gapAfterComma = t[1] - t[0], gapNormal = t[2] - t[1];
  check(gapAfterComma > gapNormal * 0.9, 'tras una coma se deja más tiempo', `${gapAfterComma.toFixed(2)} vs ${gapNormal.toFixed(2)}`);
  const long = D.wordTimings('extraordinariamente sí', { start: 0, end: 2 });
  check(long[1] > 1.2, 'una palabra larga ocupa más tiempo que una corta', long.map((v) => v.toFixed(2)).join(' '));
  check(D.wordTimings('', { start: 0, end: 1 }).length === 0, 'texto vacío no da tiempos');
}
// 7) Escala de velocidad
{
  const r = [0, 1.2, 1.3, 2.5, 3, 4.5, 5, 20].map(D.rateForAhead);
  check(r.join(',') === '1,1,1.1,1.1,1.18,1.18,1.25,1.25', 'escala de aceleración escalonada', r.join(','));
  check(D.rateForAhead(100) <= 1.25, 'nunca pasa de 1.25x');
  const calm = D.readSeconds('x'.repeat(60), 0), busy = D.readSeconds('x'.repeat(60), 6);
  check(Math.abs(calm - 4) < 1e-9 && busy < calm, 'subtítulos sin audio: ritmo de lectura, más rápido con cola', `${calm.toFixed(2)} s → ${busy.toFixed(2)} s`);
}
console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLAS`);
process.exit(fails ? 1 : 0);
