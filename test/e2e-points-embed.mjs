// Puntos de canal dentro del chat oficial embebido (iframe de /embed/{canal}/chat, como en las casillas de /multi): apagado por defecto,
// reclama el cofre con retardo cuando se enciende, respeta un canal excluido y no toca un botón destructivo.
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(here, '..', 'src');
const html = fs.readFileSync(path.join(here, 'fake-points.html'));
const exe = process.env.CHROME || (() => {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const d = fs.readdirSync(root).find((x) => x.startsWith('chromium-'));
  return path.join(root, d, 'chrome-linux64', 'chrome');
})();
const ctx = await chromium.launchPersistentContext(path.join(here, 'profile-' + Date.now()), {
  headless: false, executablePath: exe,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--lang=en-US'],
  viewport: { width: 1100, height: 800 }, locale: 'en-US',
});
await ctx.route('https://www.twitch.tv/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
await ctx.route('https://decatron.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>host</title><iframe id="f" src="https://www.twitch.tv/embed/anthonydeca/chat?parent=decatron.net" style="width:1000px;height:700px"></iframe>' }));
const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const setSettings = (p) => sw.evaluate((x) => new Promise((r) => chrome.storage.sync.set({ modules: { points: x } }, r)), p);

let failed = 0;
const check = (ok, msg) => { console.log(ok ? '✓' : '✗', msg); if (!ok) failed++; };
const page = await ctx.newPage();
await page.goto('https://decatron.net/multi/test');
const frame = page.frameLocator('#f');
await frame.locator('#claimhost').waitFor({ state: 'attached', timeout: 15000 });
const f = page.frames().find((x) => x.url().includes('/embed/'));
const claims = () => f.evaluate(() => window.claims);

await f.evaluate(() => window.addClaim());
await page.waitForTimeout(7000);
check((await claims()) === 0, 'apagado por defecto: no reclama dentro del chat embebido');

const t0 = Date.now();
await setSettings({ enabled: true });
await f.waitForFunction(() => window.claims === 1, null, { timeout: 12000 });
check(true, `encendido: reclamó el cofre del chat embebido tras ${((Date.now() - t0) / 1000).toFixed(1)} s`);

await f.evaluate(() => window.addClaim('claimable-bonus__icon ScCoreButtonDestructive-sc-x'));
await page.waitForTimeout(7000);
check((await claims()) === 1, 'un botón destructivo no se toca');
await f.evaluate(() => document.querySelectorAll('#claimhost button').forEach((b) => b.remove()));

await setSettings({ enabled: true, blocked: ['anthonydeca'] });
await page.waitForTimeout(800);
await f.evaluate(() => window.addClaim());
await page.waitForTimeout(7000);
check((await claims()) === 1, 'canal excluido: no reclama');

await ctx.close();
console.log(failed ? `${failed} comprobación(es) fallaron` : 'todo bien');
process.exit(failed ? 1 : 0);
