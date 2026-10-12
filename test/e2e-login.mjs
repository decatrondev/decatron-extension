// Inicio de sesión de la extensión: la página de login le entrega el token de espectador, la extensión lo guarda, lo manda al hub
// (?access_token=) y lo muestra en el panel. Hub simulado en 127.0.0.1 (como e2e-catchup.mjs) y el backend real solo para la consulta
// pública del canal; la página de login es una réplica servida con page.route (el script de la extensión solo corre en esa dirección).
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
const upgradeUrls = [];
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
  upgradeUrls.push(req.url);
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
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (exp) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '42', login: 'espectador1', aud: 'decatron-viewer', typ: 'viewer', exp })}.firma`;
const TOKEN = fakeToken(Math.floor(Date.now() / 1000) + 86400 * 30);
// Réplica de la página de login: entrega el token con postMessage y espera el acuse
const loginHtml = (token, exp) => `<!doctype html><body><pre id="o">esperando</pre><script>
window.addEventListener('message', e => { if (e.data && e.data.type === 'dct-viewer-token-ack') document.getElementById('o').textContent = 'ACK'; });
setTimeout(() => window.postMessage({ type: 'dct-viewer-token', token: ${JSON.stringify(token)}, login: 'espectador1', expiresAt: ${exp} }, location.origin), 600);
</script></body>`;
const exp30 = Math.floor(Date.now() / 1000) + 86400 * 30;
await ctx.route('https://decatron.net/extension/login', (r) => r.fulfill({ contentType: 'text/html', body: loginHtml(TOKEN, exp30) }));
await ctx.route('https://decatron.net/otra-pagina', (r) => r.fulfill({ contentType: 'text/html', body: loginHtml(TOKEN, exp30) }));

// Hub simulado: Join entra; Whoami contesta según `identified`
let identified = true;
const frame = (o) => JSON.stringify(o) + SEP;
onFrameText.push((raw) => {
  for (const part of String(raw).split(SEP).filter(Boolean)) {
    let msg; try { msg = JSON.parse(part); } catch { continue; }
    if (msg.protocol) { sock.send('{}' + SEP); continue; }
    if (msg.type === 1 && msg.target === 'Join') sock.send(frame({ type: 3, invocationId: msg.invocationId, result: { active: true, listeners: { en: 1 } } }));
    if (msg.type === 1 && msg.target === 'Whoami') sock.send(frame({ type: 3, invocationId: msg.invocationId, result: identified ? { identified: true, login: 'espectador1' } : { identified: false, login: null } }));
  }
});

const page = await ctx.newPage();
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const stored = () => sw.evaluate(() => new Promise((r) => chrome.storage.local.get('dctViewer', (v) => r(v.dctViewer || null))));
async function openTranslationTab() {
  await page.goto('https://www.twitch.tv/anthonydeca');
  await page.locator('.dct-btn').waitFor({ timeout: 20000 });
  await page.locator('.dct-btn').click();
  await page.locator('.dialog').waitFor();
  await page.locator('.lang', { hasText: 'English' }).waitFor({ timeout: 15000 });
}
const account = () => page.locator('.dialog').innerText();

// 1) Sin sesión: se ofrece iniciar sesión
await openTranslationTab();
check(/Sign in so channels that limit who listens/.test(await account()), 'sin sesión el panel invita a iniciar sesión');

// 2) La página de login entrega el token: la extensión lo guarda y acusa recibo
const lp = await ctx.newPage();
await lp.goto('https://decatron.net/extension/login');
await lp.waitForFunction(() => document.getElementById('o').textContent === 'ACK', null, { timeout: 8000 }).catch(() => {});
check((await lp.locator('#o').textContent()) === 'ACK', 'la extensión acusa recibo del token');
const saved = await stored();
check(saved && saved.token === TOKEN && saved.login === 'espectador1', 'el token queda guardado en la extensión', JSON.stringify(saved && { login: saved.login, exp: saved.expiresAt }));
await lp.close();

// 3) El panel (ya abierto en otra pestaña) se entera solo
await page.waitForFunction(() => /Signed in: espectador1/.test(document.querySelector('.dialog')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
check(/Signed in: espectador1/.test(await account()), 'el panel muestra «Signed in: espectador1» sin recargar');

// 4) Al elegir idioma, el token viaja en la conexión al hub
upgradeUrls.length = 0;
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /Connecting|Only you hear|Listening|waiting|speech/i.test(document.querySelector('.dialog')?.textContent || ''), null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(800);
const url = upgradeUrls[upgradeUrls.length - 1] || '';
check(url.includes('access_token=' + encodeURIComponent(TOKEN)), 'la conexión al hub lleva ?access_token=', url.slice(0, 40) + '…');

// 5) El servidor no reconoce el token (revocado o vencido en el servidor): se pide iniciar sesión otra vez
identified = false;
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForFunction(() => /session expired or was closed/i.test(document.querySelector('.dialog')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
check(/session expired or was closed/i.test(await account()), 'token no reconocido por el servidor: el panel pide iniciar sesión otra vez');
identified = true;

// 6) Token vencido en local: no se manda, sin ?access_token=
await sw.evaluate(() => new Promise((r) => chrome.storage.local.set({ dctViewer: { token: 'a.b.c', login: 'espectador1', expiresAt: Math.floor(Date.now() / 1000) - 10, at: 1 } }, r)));
await page.waitForTimeout(500);
upgradeUrls.length = 0;
await page.locator('.lang', { hasText: 'Original' }).click();
await page.locator('.lang', { hasText: 'English' }).click();
await page.waitForTimeout(1200);
check(!(upgradeUrls[upgradeUrls.length - 1] || '').includes('access_token'), 'un token vencido en local no se manda');

// 7) Seguridad: otra página de decatron.net NO puede guardar un token
await sw.evaluate(() => new Promise((r) => chrome.storage.local.remove('dctViewer', r)));
const other = await ctx.newPage();
await other.goto('https://decatron.net/otra-pagina');
await other.waitForTimeout(2000);
check((await other.locator('#o').textContent()) === 'esperando' && (await stored()) === null, 'otra página de decatron.net no guarda ningún token');
await other.close();

// 8) Cerrar sesión desde el panel borra el token
await sw.evaluate((t) => new Promise((r) => chrome.storage.local.set({ dctViewer: { token: t, login: 'espectador1', expiresAt: Math.floor(Date.now() / 1000) + 86400, at: 1 } }, r)), TOKEN);
await page.bringToFront();
await page.waitForFunction(() => /Signed in: espectador1/.test(document.querySelector('.dialog')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
await page.locator('.dialog .btn', { hasText: 'Sign out' }).click({ timeout: 5000 });
await page.waitForTimeout(600);
check((await stored()) === null && /Sign in so channels/.test(await account()), 'Sign out borra el token y vuelve a «iniciar sesión»');

await ctx.close();
wsServer.close();
console.log(fails ? `${fails} comprobación(es) fallaron` : 'TODO OK');
process.exit(fails ? 1 : 0);
