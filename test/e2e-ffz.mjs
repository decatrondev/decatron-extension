// La extensión junto a FrankerFaceZ (que rehace las líneas del chat con su propio HTML): se carga el script de FFZ en el Twitch
// real y se comprueba que los emotes que FFZ deja como texto (7TV, BTTV, propios) igual se dibujan.
// Uso: node test/e2e-ffz.mjs <canal-en-vivo>
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const channel = process.argv[2] || 'ironmouse';
const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
const executablePath = process.env.CHROME || path.join(cacheRoot, fs.readdirSync(cacheRoot).find((d) => d.startsWith('chromium-')), 'chrome-linux64', 'chrome');
let fails = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); if (!ok) fails++; };

const sev = (await (await fetch('https://7tv.io/v3/emote-sets/global')).json()).emotes.filter((e) => !(e.flags & 1) && !((e.data.flags || 0) & 256));
const NAME = sev[0].name;

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'dct-ffz-' + Date.now()), {
  headless: false, executablePath,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  viewport: { width: 1600, height: 900 }, locale: 'es-ES',
});
const page = await ctx.newPage();
await page.goto(`https://www.twitch.tv/${channel}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(8000);
await page.addScriptTag({ url: 'https://cdn.frankerfacez.com/static/script.min.js' });
await page.waitForFunction(() => !!window.FrankerFaceZ, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(25000);

const state = await page.evaluate(() => {
  const lines = [...document.querySelectorAll('.chat-line__message')];
  return { ffz: !!window.FrankerFaceZ, lines: lines.length, ffzShaped: lines.filter((l) => l.querySelector('.message') && !l.querySelector('[data-a-target="chat-line-message-body"]')).length };
});
check('FFZ cargado y rehaciendo las líneas del chat', state.ffz && state.ffzShaped > 0, JSON.stringify(state));

// Una línea con la forma exacta que deja FFZ
await page.evaluate((a) => {
  const box = document.querySelector('.chat-scrollable-area__message-container');
  const d = document.createElement('div');
  d.className = 'chat-line__message';
  d.setAttribute('data-user', 'prueba');
  d.innerHTML = `<span class="chat-line__message--badges"></span><span class="chat-line__username notranslate" role="button"><span class="chat-author__display-name">prueba</span></span><span aria-hidden="true">: </span><span class="message"><span class="text-fragment" data-a-target="chat-message-text">hola ${a} fin</span></span>`;
  box.appendChild(d);
}, NAME);
await page.waitForTimeout(1500);
const injected = await page.evaluate(() => { const l = [...document.querySelectorAll('.chat-line__message[data-user="prueba"]')][0]; return l ? l.querySelectorAll('.dct-emote').length : -1; });
check(`una línea con la forma de FFZ: ${NAME} se dibuja`, injected === 1);

// Mensajes reales que FFZ dejó con palabras de emotes sin reemplazar
const real = await page.evaluate(() => [...document.querySelectorAll('.chat-line__message')].filter((l) => !l.hasAttribute('data-user') || l.getAttribute('data-user') !== 'prueba').filter((l) => l.querySelector('.dct-emote')).length);
console.log('mensajes reales con emotes dibujados por Decatron:', real);
const diag = await page.evaluate(() => document.querySelectorAll('.text-fragment').length);
check('hay trozos de texto reales en el chat', diag > 0, `(${diag})`);
await ctx.close();
console.log(fails === 0 ? 'TODO OK' : `${fails} FALLAS`);
process.exit(fails ? 1 : 0);
