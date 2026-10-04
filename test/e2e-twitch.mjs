// Prueba la extensión contra el Twitch REAL (chat público, sin iniciar sesión): botón, panel, carga de emotes,
// reemplazo en el chat (con líneas de prueba que se inyectan en el contenedor real) y el selector con ":".
// Uso: node test/e2e-twitch.mjs <canal-en-vivo> [carpeta-de-capturas]
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const channel = process.argv[2] || 'ironmouse';
const shots = process.argv[3] || path.join(os.tmpdir(), 'dct-shots');
fs.mkdirSync(shots, { recursive: true });
const here = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(here, '..', 'src');

const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
const chromiumDir = fs.readdirSync(cacheRoot).find((d) => d.startsWith('chromium-'));
const executablePath = process.env.CHROME || path.join(cacheRoot, chromiumDir, 'chrome-linux64', 'chrome');

let fails = 0;
const check = (name, ok, extra = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); if (!ok) fails++; };

// Nombres reales de emotes para armar las líneas de prueba
const sev = (await (await fetch('https://7tv.io/v3/emote-sets/global')).json()).emotes.filter((e) => !(e.flags & 1) && !((e.data.flags || 0) & 256));
const bttv = await (await fetch('https://api.betterttv.net/3/cached/emotes/global')).json();
const zwAll = (await (await fetch('https://7tv.io/v3/emote-sets/global')).json()).emotes.filter((e) => (e.flags & 1) || ((e.data.flags || 0) & 256));
const ZW = zwAll[0]?.name;
const SEV = sev[0].name, SEV2 = sev[1].name, BTTV = bttv.find((e) => !['SoSnowy', 'IceCold', 'SantaHat', 'TopHat', 'ReinDeer', 'CandyCane', 'cvMask', 'cvHazmat'].includes(e.code)).code;

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'dct-profile-' + Date.now()), {
  headless: false,
  executablePath,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  viewport: { width: 1600, height: 900 },
  locale: 'es-ES',
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.text().includes('decatron')) logs.push(m.text()); });
// Solo cuentan los errores que vienen de la extensión: Twitch tiene los suyos (por ejemplo getLayoutMap en iframes)
page.on('pageerror', (e) => { if (String(e.stack || '').includes('chrome-extension://')) logs.push('PAGEERROR ' + e.message); });
await page.goto(`https://www.twitch.tv/${channel}`, { waitUntil: 'domcontentloaded', timeout: 60000 });

// ── botón en el player
const btn = page.locator('.dct-btn');
await btn.waitFor({ timeout: 30000 }).catch(() => {});
check('el botón de Decatron aparece en el player', await btn.count() === 1);
check('la extensión cargó y arrancó', logs.some((l) => l.includes('Decatron') && l.includes('cargada')), logs.find((l) => l.includes('cargada')) || '');

// ── panel
await btn.click({ force: true });
await page.locator('.dialog').waitFor({ timeout: 5000 });
check('el panel se abre con una pestaña por módulo', (await page.locator('.nav-item').count()) === 3);
check('hay un módulo "próximamente"', (await page.locator('.nav-item .tag').count()) === 1);
await page.screenshot({ path: path.join(shots, '1-panel-traduccion.png') });
await page.locator('.nav-item', { hasText: /Emotes/ }).click();
await page.locator('.notice.ok').waitFor({ timeout: 25000 }).catch(() => {});
const statusText = (await page.locator('.dialog .notice').first().textContent()) || '';
check('los emotes cargan para el canal', /emotes cargados/.test(statusText), statusText.trim());
await page.screenshot({ path: path.join(shots, '2-panel-emotes.png') });
await page.keyboard.press('Escape');
check('Escape cierra el panel', (await page.locator('.dialog').count()) === 0);

// ── reemplazo en el chat real: se agregan líneas con la forma de Twitch al contenedor verdadero
const injected = await page.evaluate(({ a, b, c, z }) => {
  const box = document.querySelector('.chat-scrollable-area__message-container');
  if (!box) return false;
  const mk = (text, user) => {
    const d = document.createElement('div');
    d.className = 'chat-line__message';
    d.innerHTML = `<div><span class="chat-line__username">${user}</span><span class="chat-line__message-container"><span data-a-target="chat-line-message-body" dir="auto"><span class="text-fragment" data-a-target="chat-message-text">${text}</span></span></span></div>`;
    box.appendChild(d);
  };
  mk(`hola ${a} y ${b} bien ${c}!`, 'prueba1');
  mk(`${a}${a}`, 'prueba2');
  mk('sin emotes aquí', 'prueba3');
  if (z) mk(`${a} ${z}`, 'prueba4');
  return true;
}, { a: SEV, b: BTTV, c: SEV2, z: ZW });
check('encontré el contenedor del chat real de Twitch', injected);
await page.waitForTimeout(1500);
const lines = await page.evaluate(() => [...document.querySelectorAll('.chat-line__message')].filter((l) => /prueba\d/.test(l.textContent + l.innerHTML)).map((l) => ({ emotes: l.querySelectorAll('.dct-emote').length, imgs: l.querySelectorAll('.dct-emote-img').length, text: l.querySelector('[data-a-target="chat-line-message-body"]')?.textContent.trim() })));
console.log('líneas de prueba:', JSON.stringify(lines));
check('línea 1: dos emotes de proveedores externos dibujados y el de puntuación pegada no', lines[0] && lines[0].emotes === 2, `(${SEV}, ${BTTV} sí; ${SEV2}! no)`);
check('línea 2: dos emotes juntos pegados no se reemplazan (no son palabras separadas)', lines[1] && lines[1].emotes === 0);
check('línea 3: sin emotes queda igual', lines[2] && lines[2].emotes === 0 && lines[2].text === 'sin emotes aquí');
if (ZW) check(`línea 4: un emote "encima del anterior" (${ZW}) se apila sobre el emote de antes`, lines[3] && lines[3].emotes === 1 && lines[3].imgs === 2, JSON.stringify(lines[3]));
const imgOk = await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('.dct-emote-img')];
  await Promise.all(imgs.map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; }))));
  return imgs.length > 0 && imgs.every((i) => i.naturalWidth > 0);
});
check('las imágenes de los emotes cargan en twitch.tv (la CSP las deja pasar)', imgOk);
const size = await page.evaluate(() => { const i = document.querySelector('.dct-emote-img'); return i ? Math.round(i.getBoundingClientRect().height) : 0; });
check('tamaño normal de 28 px', size === 28, `(${size}px)`);
await page.screenshot({ path: path.join(shots, '3-chat-con-emotes.png') });

// ── apagar el módulo
await btn.click({ force: true });
await page.locator('.nav-item', { hasText: /Emotes/ }).click();
await page.locator('.head .switch').click();
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.evaluate((a) => {
  const box = document.querySelector('.chat-scrollable-area__message-container');
  const d = document.createElement('div'); d.className = 'chat-line__message';
  d.innerHTML = `<span data-a-target="chat-line-message-body"><span class="text-fragment">tras apagar ${a}</span></span>`;
  box.appendChild(d);
}, SEV);
await page.waitForTimeout(1200);
const after = await page.evaluate(() => [...document.querySelectorAll('.chat-line__message')].filter((l) => l.textContent.includes('tras apagar'))[0]?.querySelectorAll('.dct-emote').length);
check('con el módulo apagado ya no se dibujan emotes nuevos', after === 0);

console.log('\nlogs de la extensión:', logs.slice(0, 6).join(' | '));
check('sin errores de página', !logs.some((l) => l.startsWith('PAGEERROR')), logs.filter((l) => l.startsWith('PAGEERROR')).join(' | '));
await ctx.close();
console.log(fails === 0 ? 'TODO OK' : `${fails} FALLAS`);
process.exit(fails ? 1 : 0);
