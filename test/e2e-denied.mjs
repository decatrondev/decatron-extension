// Traducción: la extensión entiende cuando el canal le rechaza la entrada (tope de oyentes, pausa del streamer…) y lo explica.
// Hub simulado en 127.0.0.1 (como e2e-catchup.mjs) y el backend real solo para la consulta pública del canal.
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import crypto from 'node:crypto';

const here = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.resolve(here, '..', 'src');
const SEP = '\x1e';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dct-denied-'));
const html = fs.readFileSync(path.join(here, 'fake-twitch.html'));
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

const ctx = await chromium.launchPersistentContext(path.join(tmp, 'profile'), {
  headless: false,
  executablePath: process.env.CHROME || (() => { const root = path.join(os.homedir(), '.cache', 'ms-playwright'); const d = fs.readdirSync(root).find((x) => x.startsWith('chromium-')); return path.join(root, d, 'chrome-linux64', 'chrome'); })(),
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--lang=en-US', '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessRespectPreflightResults,BlockInsecurePrivateNetworkRequests'],
  viewport: { width: 1100, height: 700 }, locale: 'en-US',
});
await ctx.route('https://www.twitch.tv/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));

// El servidor simulado contesta a Join según el modo: rechaza con un motivo o deja entrar (y luego expulsa)
let mode = { type: 'deny', reason: 'full' };
const frame = (o) => JSON.stringify(o) + SEP;
onFrameText.push((raw) => {
  for (const part of String(raw).split(SEP).filter(Boolean)) {
    let msg; try { msg = JSON.parse(part); } catch { continue; }
    if (msg.protocol) { sock.send('{}' + SEP); continue; }
    if (msg.type === 1 && msg.target === 'Join') {
      if (mode.type === 'deny') sock.send(frame({ type: 3, invocationId: msg.invocationId, result: { ok: false, error: 'denied', reason: mode.reason, active: false, minFollowDays: mode.days, minSubTier: mode.tier } }));
      else {
        sock.send(frame({ type: 3, invocationId: msg.invocationId, result: { active: true, listeners: { en: 1 } } }));
        setTimeout(() => sock.send(frame({ type: 1, target: 'Denied', arguments: [{ reason: 'paused' }] })), 1200);
      }
    }
  }
});

const page = await ctx.newPage();
async function openTranslation() {
  await page.goto('https://www.twitch.tv/anthonydeca');
  await page.locator('.dct-btn').waitFor({ timeout: 20000 });
  await page.locator('.dct-btn').click();
  await page.locator('.dialog').waitFor();
  await page.locator('.lang', { hasText: 'English' }).waitFor({ timeout: 15000 });
}
const notice = () => page.locator('.dialog .notice').first().innerText();

// 1) Tope de oyentes: se explica y hay botón para reintentar
await openTranslation();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /maximum of listeners/i.test(document.querySelector('.dialog .notice')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
let n = await notice();
check(/maximum of listeners/i.test(n), 'entrada rechazada por tope de oyentes se explica', `«${n}»`);
const retryBtn = () => page.locator('.dialog .btn.primary', { hasText: /try again/i }).count();
check((await retryBtn()) > 0, 'ofrece reintentar cuando el motivo es pasajero');

// 2) Motivo que no se reintenta (el canal no ofrece ese idioma): sin botón de reintento
mode = { type: 'deny', reason: 'language' };
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /doesn.t offer that language/i.test(document.querySelector('.dialog .notice')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
n = await notice();
check(/doesn.t offer that language/i.test(n), 'motivo «idioma no ofrecido»', `«${n}»`);
check((await retryBtn()) === 0, 'sin botón de reintento cuando no tiene sentido');


// 3b) Nivel de acceso del canal: seguidores (dice cuántos días) y pedir iniciar sesión (ofrece el botón)
mode = { type: 'deny', reason: 'follow', days: 7 };
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /followers/i.test(document.querySelector('.dialog .notice')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
n = await notice();
check(/followers \(7 days or more\)/i.test(n), 'nivel «seguidores»: explica los días que se piden', `«${n}»`);
mode = { type: 'deny', reason: 'sub', tier: 2 };
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /subscribers/i.test(document.querySelector('.dialog .notice')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
n = await notice();
check(/subscribers \(tier 2 or higher\)/i.test(n), 'nivel «suscriptores»: explica el nivel que se pide', `«${n}»`);
mode = { type: 'deny', reason: 'login' };
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /sign in to listen/i.test(document.querySelector('.dialog .notice')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
n = await notice();
check(/asks you to sign in/i.test(n), 'nivel «con sesión»: pide iniciar sesión', `«${n}»`);
check((await page.locator('.dialog .btn.primary', { hasText: /sign in/i }).count()) > 0, 'ofrece el botón Sign in en el aviso');

// 3) Entra y luego el streamer usa el botón de pánico: lo sacan y se le dice
mode = { type: 'allow' };
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /paused translation/i.test(document.querySelector('.dialog .notice')?.textContent || ''), null, { timeout: 9000 }).catch(() => {});
n = await notice();
check(/paused translation/i.test(n), 'expulsión por pausa del streamer se explica', `«${n}»`);

await ctx.close();
wsServer.close();
console.log(fails ? `${fails} comprobación(es) fallaron` : 'TODO OK');
process.exit(fails ? 1 : 0);
