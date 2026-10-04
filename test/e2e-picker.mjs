// El selector de emotes con ":" contra un editor Slate de verdad (la caja de chat de Twitch es Slate): se sirve como
// https://www.twitch.tv/slatetest con la extensión cargada. Escribe ":", elige con Tab y mira lo que quedó en el editor.
import { chromium } from 'playwright-core';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const here = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(here, '..', 'src');
const html = fs.readFileSync(path.join(here, 'fake-slate.html'));
const shots = process.argv[2] || path.join(os.tmpdir(), 'dct-shots');
fs.mkdirSync(shots, { recursive: true });
const cacheRoot = path.join(os.homedir(), '.cache', 'ms-playwright');
const executablePath = process.env.CHROME || path.join(cacheRoot, fs.readdirSync(cacheRoot).find((d) => d.startsWith('chromium-')), 'chrome-linux64', 'chrome');
let fails = 0;
const check = (n, ok, extra = '') => { console.log((ok ? 'OK   ' : 'FAIL ') + n + (extra ? '  ' + extra : '')); if (!ok) fails++; };

const sev = (await (await fetch('https://7tv.io/v3/emote-sets/global')).json()).emotes.filter((e) => !(e.flags & 1));
const NAME = sev[0].name;

const ctx = await chromium.launchPersistentContext(path.join(os.tmpdir(), 'dct-slate-' + Date.now()), {
  headless: false, executablePath,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox'],
  viewport: { width: 900, height: 600 },
});
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (m.text().includes('decatron')) logs.push(m.text()); });
page.on('pageerror', (e) => { if (String(e.stack || '').includes('chrome-extension://')) logs.push('PAGEERROR ' + e.message); });
await page.route('https://www.twitch.tv/slatetest', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
await page.goto('https://www.twitch.tv/slatetest');
await page.waitForFunction(() => document.title.includes('(listo)'), null, { timeout: 40000 });
await page.waitForTimeout(6000); // el diccionario de emotes globales

const input = page.locator('[data-a-target="chat-input"]');
await input.click();
await page.keyboard.type('hola :' + NAME.slice(0, 3), { delay: 50 });
await page.locator('#decatron-picker .item').first().waitFor({ timeout: 5000 }).catch(() => {});
const n = await page.locator('#decatron-picker .item').count();
check('al escribir ":" y unas letras aparece la lista', n > 0, `(${n} opciones para :${NAME.slice(0, 3)})`);
await page.screenshot({ path: path.join(shots, 'picker.png') });

await page.keyboard.press('ArrowDown');
await page.waitForTimeout(100);
const picked = ((await page.locator('#decatron-picker .item.on .name').textContent()) || '').trim();
check('las flechas mueven la selección', picked !== '', `(${picked})`);
await page.keyboard.press('Tab');
await page.waitForTimeout(500);
const text = await page.evaluate(() => window.__text());
check('Tab inserta el emote en el editor Slate, reemplaza el ":xxx" y deja un espacio', text === `hola ${picked} `, `(editor: «${text}»)`);
check('la lista se cierra', (await page.locator('#decatron-picker').count()) === 0);

await page.keyboard.type(' :' + NAME.slice(0, 3), { delay: 50 });
await page.locator('#decatron-picker .item').first().waitFor({ timeout: 4000 }).catch(() => {});
await page.keyboard.press('Escape');
check('Escape cierra la lista sin tocar el texto', (await page.locator('#decatron-picker').count()) === 0 && (await page.evaluate(() => window.__text())).endsWith(':' + NAME.slice(0, 3)), `(editor: «${await page.evaluate(() => window.__text())}»)`);
await page.keyboard.press('Enter');
check('Enter sin lista no es del selector (Twitch lo recibe)', (await page.locator('#decatron-picker').count()) === 0);

await page.keyboard.press('Control+A'); await page.keyboard.press('Backspace');
await page.keyboard.type('a:' + NAME.slice(0, 3), { delay: 50 });
await page.waitForTimeout(400);
check('un ":" pegado a una palabra no abre la lista (como en una hora 10:30)', (await page.locator('#decatron-picker').count()) === 0);

console.log('logs:', logs.slice(0, 4).join(' | '));
check('sin errores de página', !logs.some((l) => l.startsWith('PAGEERROR')));
await ctx.close();
console.log(fails === 0 ? 'TODO OK' : `${fails} FALLAS`);
process.exit(fails ? 1 : 0);
