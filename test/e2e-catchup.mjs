// E2E del modo alcance, historial, repetir y "solo subtítulos": Chromium real con la extensión cargada y un hub de
// traducción SIMULADO (page.routeWebSocket) que manda ráfagas de frases con audio MP3. No toca producción salvo el
// GET público del canal (enabled/idiomas), igual que e2e.mjs. npm run test:catchup
import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(here, '..', 'src');
const html = fs.readFileSync(path.join(here, 'fake-twitch.html'));
const webm = fs.readFileSync(path.join(here, 'fake-stream.webm'));
const SEP = '\x1e';

// 2.5 s de tono (24 kHz mono) como audio de una frase
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dct-'));
const mp3Path = path.join(tmp, 'tone.mp3');
execSync(`ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=220:duration=2.5" -ar 24000 -ac 1 -b:a 48k "${mp3Path}"`);
const mp3 = fs.readFileSync(mp3Path);

// ───────────── hub simulado: servidor WebSocket mínimo en 127.0.0.1 (el WebSocket de un content script vive en su mundo
// aislado y page.routeWebSocket no lo ve), y una copia de la extensión apuntando a él.
let sock = null;
const onFrameText = [];
const wsServer = http.createServer();
wsServer.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64') + '\r\n\r\n');
  let buf = Buffer.alloc(0);
  const api = {
    send(text) {
      const body = Buffer.from(text);
      const head = body.length < 126 ? Buffer.from([0x81, body.length]) : body.length < 65536 ? Buffer.from([0x81, 126, body.length >> 8, body.length & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(body.length), 2); return h; })();
      socket.write(Buffer.concat([head, body]));
    },
  };
  sock = api;
  socket.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      const op = buf[0] & 15; let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4); const data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
      buf = buf.subarray(off + 4 + len);
      if (op === 1) onFrameText.forEach((fn) => fn(data.toString()));
      if (op === 8) { socket.end(); return; }
    }
  });
  socket.on('error', () => {});
});
await new Promise((r) => wsServer.listen(0, '127.0.0.1', r));
const PORT = wsServer.address().port;
const EXT = path.join(tmp, 'ext');
fs.cpSync(SRC, EXT, { recursive: true });
const trPath = path.join(EXT, 'modules', 'translation.js');
const trSrc = fs.readFileSync(trPath, 'utf8');
if (!trSrc.includes('wss://decatron.net/hubs/translation')) throw new Error('no encontré la URL del hub para parchar');
fs.writeFileSync(trPath, trSrc.replace('wss://decatron.net/hubs/translation', `ws://127.0.0.1:${PORT}/hub`));

let fails = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${name} ${detail}`); if (!ok) fails++; };

const logs = [];
const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  headless: false,
  executablePath: process.env.CHROME || (() => { const root = path.join(os.homedir(), '.cache', 'ms-playwright'); const d = fs.readdirSync(root).find((x) => x.startsWith('chromium-')); return d ? path.join(root, d, 'chrome-linux64', 'chrome') : undefined; })(),
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'],
  viewport: { width: 1100, height: 700 },
});
const page = await ctx.newPage();
const allConsole = [];
page.on('console', (m) => { allConsole.push(m.type() + ': ' + m.text()); if (m.text().includes('decatron')) logs.push(m.text()); });
page.on('pageerror', (e) => { logs.push('PAGEERROR ' + e.message); });

// ───────────── protocolo SignalR sobre el servidor de arriba
let seq = 0;
const frame = (o) => JSON.stringify(o) + SEP;
onFrameText.push((raw) => {
  for (const part of String(raw).split(SEP).filter(Boolean)) {
    let msg; try { msg = JSON.parse(part); } catch { continue; }
    if (msg.protocol) { sock.send('{}' + SEP); continue; }
    if (msg.type === 1 && msg.target === 'Join') sock.send(frame({ type: 3, invocationId: msg.invocationId, result: { active: true, listeners: { [msg.arguments[1]]: 1 } } }));
  }
});
const push = (target, payload) => sock.send(frame({ type: 1, target, arguments: [payload] }));
const sendSegment = (text, extra = {}, withAudio = true) => {
  const n = ++seq;
  push('SegmentStart', { seq: n, lang: 'en', t0: 0, t1: 2.5, source: 'texto original ' + n, text, sttAt: new Date().toISOString(), sttLag: 0.8, ageMs: 300, ...extra });
  if (withAudio) for (let i = 0; i < mp3.length; i += 4096) push('SegmentChunk', { seq: n, data: mp3.subarray(i, i + 4096).toString('base64') });
  push('SegmentEnd', { seq: n, bytes: mp3.length, error: !withAudio });
  return n;
};

await page.route('https://www.twitch.tv/**', (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('fake-stream.webm')) return route.fulfill({ status: 200, contentType: 'video/webm', body: webm });
  return route.fulfill({ status: 200, contentType: 'text/html', body: html });
});
await page.goto('https://www.twitch.tv/anthonydeca');
await page.locator('.dct-btn').waitFor({ timeout: 20000 });
await page.locator('.dct-btn').click();
await page.locator('.dialog').waitFor();
await page.locator('.lang').first().waitFor({ timeout: 15000 });
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => true);
for (let i = 0; i < 50 && !sock; i++) await page.waitForTimeout(100);
check(!!sock, 'la extensión se conectó al hub simulado');
if (!sock) { console.log('--- consola de la página ---\n' + allConsole.slice(-25).join('\n')); console.log('lang on:', await page.locator('.lang.on').allTextContents()); }
await page.waitForTimeout(600);
const stateText = await page.locator('.dialog .notice').first().textContent();
check(/Solo tú|Only you|En vivo|Live/i.test(stateText || ''), 'estado tras unirse', `«${(stateText || '').trim()}»`);

// ───────────── 1) Ráfaga: 6 frases de 2.5 s de golpe = 15 s de audio. Tiene que acelerar y, al pasar el límite, omitir con aviso.
const phrases = [
  'Hoy quiero contarles cómo preparo mi receta favorita de lasaña',
  'Primero hay que preparar la salsa con tomate fresco y cebolla',
  'Mientras se cocina aprovecho para hervir las láminas de pasta',
  'Luego armo las capas alternando salsa, queso y carne molida',
  'Cuando termino la última capa la meto al horno cuarenta minutos',
  'Y a veces la dejo un poco más si quiero que quede bien dorada',
];
const t0 = Date.now();
for (const p of phrases) sendSegment(p);
await page.waitForTimeout(2500);
const stretched = logs.filter((l) => /seg \d+: .*\(x(1\.\d+)\)/.test(l)).map((l) => Number(l.match(/\(x(1\.\d+)\)/)[1]));
const allRates = logs.filter((l) => /\] seg \d+: /.test(l) && /\(x\d/.test(l)).map((l) => Number(l.match(/\(x([\d.]+)\)/)[1]));
console.log('   velocidades por frase:', allRates.join(', '));
check(allRates[0] === 1, 'la primera frase va a velocidad normal');
const MAXR = Number(process.env.MAX_RATE || 1.25);   // con MAX_RATE se prueba que la extensión obedece al servidor
check(stretched.length >= 2 && stretched.every((r) => r <= MAXR), `las siguientes se aceleran por escalones, sin pasar de ${MAXR}x`, stretched.join(','));
if (process.env.MAX_RATE) check(stretched.includes(MAXR), `la extensión usó la velocidad que mandó el servidor (${MAXR}x)`, stretched.join(','));
if (!process.env.MAX_RATE) check(new Set(stretched).size >= 2, 'la aceleración sube con el atraso (más de un escalón)', [...new Set(stretched)].join(','));
check(!logs.some((l) => /estirar falló|PAGEERROR/.test(l)), 'el estiramiento no falló y no hubo errores de página', logs.filter((l) => /estirar falló|PAGEERROR/.test(l)).join(' | '));
const skippedLogs = logs.filter((l) => /omitido por atraso/.test(l)).length;
check(skippedLogs >= 1, 'al pasar el límite se omiten frases viejas', `omitidas=${skippedLogs}`);
const notice = await page.locator('.dct-notice').first();
let noticeText = '';
for (let i = 0; i < 20; i++) { if (await notice.isVisible().catch(() => false)) { noticeText = (await notice.textContent()) || ''; break; } await page.waitForTimeout(150); }
check(/omiti|skipped/i.test(noticeText), 'se avisa sobre el video', `«${noticeText}»`);

// subtítulo con palabras por tiempo
await page.waitForTimeout(500);
const cap = await page.evaluate(() => { const t = document.querySelector('.dct-cap-text'); return t ? { words: t.querySelectorAll('.dct-w').length, on: t.querySelectorAll('.dct-w.dct-on').length, hidden: document.querySelector('.dct-captions').hidden } : null; });
check(!!cap && !cap.hidden && cap.words > 3, 'hay subtítulo visible', JSON.stringify(cap));

// estado y retraso en el panel
await page.waitForTimeout(1500);
const panelText = await page.locator('.dialog').first().innerText();
check(/Retraso aproximado|Approximate delay/i.test(panelText), 'el panel muestra el retraso');
check(/≈ \d/.test(panelText), 'el retraso trae un número', (panelText.match(/≈ [\d.]+ s/) || [''])[0]);
check(/Frases omitidas|Phrases skipped/i.test(panelText), 'el panel cuenta las frases omitidas', (panelText.match(/(Frases omitidas|Phrases skipped)[^\n]*\n?[^\n]*/i) || [''])[0].replace(/\n/g, ' '));
check(/Lo último dicho|Latest phrases/i.test(panelText), 'el panel tiene el historial');
const histItems = await page.locator('.hist-item').count();
check(histItems >= 4, 'el historial lista las frases', `items=${histItems}`);
check(await page.locator('.hist-item.skipped').count() >= 1, 'las omitidas se ven marcadas en el historial');

// ───────────── 2) Esperar a que se vacíe la cola y repetir la última frase
await page.waitForTimeout(14000);
const before = logs.filter((l) => /▶ seg/.test(l)).length;
const replayBtn = page.locator('.hist-play').first();
check(await replayBtn.count() > 0, 'hay botón de repetir en frases con audio');
await replayBtn.click();
await page.waitForTimeout(1200);
const after = logs.filter((l) => /▶ seg/.test(l)).length;
const lastLog = logs.filter((l) => /▶ seg/.test(l)).pop() || '';
check(after === before + 1 && /seg -\d+/.test(lastLog) && /x1[ )]/.test(lastLog), 'repetir vuelve a sonar a velocidad normal', lastLog.slice(0, 90));
await page.waitForTimeout(2600);

// ───────────── 3) Solo subtítulos: nada suena, el texto sale al llegar
const playedBefore = logs.filter((l) => /▶ seg/.test(l)).length;
const toggle = page.locator('.row', { hasText: /Solo subtítulos|Captions only/ }).locator('input[type=checkbox]');
await toggle.check({ force: true });
await page.waitForTimeout(500);
sendSegment('Esta frase solo se lee en pantalla, sin voz', {}, true);
await page.waitForTimeout(700);
const capOnly = await page.evaluate(() => { const t = document.querySelector('.dct-cap-text'); return { txt: t && t.textContent.trim(), hidden: document.querySelector('.dct-captions').hidden }; });
check(!capOnly.hidden && /solo se lee/.test(capOnly.txt || ''), 'en solo subtítulos el texto sale apenas llega', `«${capOnly.txt}»`);
check(logs.filter((l) => /▶ seg/.test(l)).length === playedBefore, 'y no suena nada');
// ráfaga de texto: se acelera la lectura, no se pierde
for (let i = 0; i < 4; i++) sendSegment('Frase de lectura número ' + (i + 1) + ' con algo de texto para leer', {}, true);
await page.waitForTimeout(500);
const vol = await page.evaluate(() => document.querySelector('video').volume);
check(vol > 0.9, 'sin audio no baja el volumen del video', `volumen=${vol.toFixed(2)}`);
await toggle.uncheck({ force: true });
await page.waitForTimeout(400);

// ───────────── 4) Servidor omite una frase (SegmentDropped): se cuenta y se avisa
const skippedBefore = (await page.locator('.dialog').first().innerText()).match(/(?:Frases omitidas en esta sesión|Phrases skipped this session)\s*\n?\s*(\d+)/i);
push('SegmentDropped', { seq: 9999, lang: 'en', reason: 'stale' });
await page.waitForTimeout(900);
const skippedAfter = (await page.locator('.dialog').first().innerText()).match(/(?:Frases omitidas en esta sesión|Phrases skipped this session)\s*\n?\s*(\d+)/i);
check(skippedAfter && Number(skippedAfter[1]) === Number(skippedBefore ? skippedBefore[1] : 0) + 1, 'una omisión del servidor suma al contador', `${skippedBefore && skippedBefore[1]} → ${skippedAfter && skippedAfter[1]}`);

await page.screenshot({ path: path.join(here, 'shot-catchup.png') });
await ctx.close();
wsServer.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails === 0 ? '\nTODO OK' : `\n${fails} FALLAS`);
process.exit(fails ? 1 : 0);
