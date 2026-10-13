// Módulo de puntos de canal: prueba de punta a punta en un Chromium real con la extensión cargada y una réplica del cofre del
// bonus de Twitch. Comprueba: apagado por defecto, reclamo con retardo de 1 a 5 s y aviso «+50», botón destructivo sin tocar,
// canal bloqueado sin reclamar y detección de FrankerFaceZ. No necesita red ni cuenta de Twitch.
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
await ctx.route('https://www.twitch.tv/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
const setSettings = (patch) => sw.evaluate((p) => new Promise((r) => chrome.storage.sync.set({ modules: { points: p } }, r)), patch);

let failed = 0;
const check = (ok, msg) => { console.log(ok ? '✓' : '✗', msg); if (!ok) failed++; };
const page = await ctx.newPage();
await page.goto('https://www.twitch.tv/anthonydeca');
await page.locator('.dct-btn').waitFor({ timeout: 20000 });
const claims = () => page.evaluate(() => window.claims);

// 1) Apagado por defecto: aparece el cofre y NO se reclama
await page.evaluate(() => window.addClaim());
await page.waitForTimeout(7000);
check((await claims()) === 0, 'apagado por defecto: el cofre no se reclama');

// 2) Se enciende: el cofre que ya estaba se reclama entre 1 y 5 s, y sale el aviso «+50 points»
const t0 = Date.now();
await setSettings({ enabled: true });
await page.waitForFunction(() => window.claims === 1, null, { timeout: 12000 });
const took = (Date.now() - t0) / 1000;
check(took >= 0.9 && took <= 7, `reclamó el cofre existente tras ${took.toFixed(1)} s (retardo aleatorio de 1 a 5 s más el aviso del cambio)`);
await page.locator('.dct-pts-toast').waitFor({ timeout: 6000 });
const toast = (await page.locator('.dct-pts-toast').textContent()).trim();
check(toast === '+50 points', `aviso sobre el saldo: «${toast}»`);

// 3) Un cofre nuevo mientras está encendido se reclama solo
await page.evaluate(() => window.addClaim());
await page.waitForFunction(() => window.claims === 2, null, { timeout: 12000 });
check(true, 'un cofre nuevo se reclama solo');

// 4) Un botón destructivo con la misma clase NO se toca
await page.evaluate(() => window.addClaim('claimable-bonus__icon ScCoreButtonDestructive-sc-x'));
await page.waitForTimeout(7000);
check((await claims()) === 2, 'un botón con ScCoreButtonDestructive no se reclama');
await page.evaluate(() => document.querySelectorAll('#claimhost button').forEach((b) => b.remove()));

// 5) Canal bloqueado: no reclama
await setSettings({ enabled: true, blocked: ['anthonydeca'] });
await page.waitForTimeout(800);
await page.evaluate(() => window.addClaim());
await page.waitForTimeout(7000);
check((await claims()) === 2, 'canal bloqueado: el cofre no se reclama');

// 6) Detección de FrankerFaceZ en el panel
await setSettings({ enabled: true, blocked: [] });
await page.evaluate(() => { const s = document.createElement('script'); s.id = 'ffz-script'; document.head.append(s); document.querySelectorAll('#claimhost button').forEach((b) => b.remove()); });
await page.locator('.dct-btn').click();
await page.locator('.dialog').waitFor();
await page.locator('.nav-name', { hasText: 'Channel points' }).click();
await page.waitForTimeout(600);
const panel = await page.locator('.dialog').innerText();
check(/FrankerFaceZ/.test(panel), 'el panel avisa que detectó FrankerFaceZ');
check(/Ready: it claims the bonus/.test(panel), 'el panel muestra «Listo» con el sistema de puntos presente');
await page.screenshot({ path: path.join(here, 'shot-points-panel.png') });

// 7) Popup de la barra del navegador: lista los 4 módulos, ya sin «Pronto», y el de puntos nace apagado
await setSettings({});               // vuelve a los valores de fábrica del módulo de puntos
await sw.evaluate(() => new Promise((r) => chrome.storage.sync.remove('modules', r)));
const extId = new URL(sw.url()).host;
const popup = await ctx.newPage();
await popup.goto(`chrome-extension://${extId}/popup.html`);
await popup.waitForTimeout(500);
const rows = await popup.locator('#mods .row').allInnerTexts();
check(rows.length === 4, `el popup lista 4 módulos: ${rows.map((x) => x.trim()).join(' | ')}`);
check(!rows.some((x) => /soon|pronto/i.test(x)), 'ningún módulo aparece como «Pronto»');
const ptRow = popup.locator('#mods .row', { hasText: 'Channel points' });
check(!(await ptRow.locator('input').isChecked()), 'puntos de canal sale apagado por defecto');
check(await popup.locator('#mods .row', { hasText: 'Multi-view' }).locator('input').isChecked(), 'Multi-view sale encendido por defecto');
await ptRow.locator('input').check();
await popup.waitForTimeout(400);
const saved = await sw.evaluate(() => new Promise((r) => chrome.storage.sync.get({ modules: {} }, (v) => r(v.modules.points))));
check(saved && saved.enabled === true, `al encenderlo en el popup se guarda: ${JSON.stringify(saved)}`);
await popup.screenshot({ path: path.join(here, 'shot-popup.png') });

await ctx.close();
console.log(failed ? `${failed} comprobación(es) fallaron` : 'todo bien');
process.exit(failed ? 1 : 0);
