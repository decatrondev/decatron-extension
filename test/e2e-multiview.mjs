// Módulo Multi-view: prueba de punta a punta en un Chromium real con la extensión cargada.
// Sirve una réplica del player en https://www.twitch.tv/<canal> y usa el decatron.net real: abre el Multi-view desde el panel,
// suma un segundo canal a ese mismo Multi-view SIN recargarlo (los videos no se cortan) y comprueba el aviso de duplicado.
// Requiere un Chromium (CHROME=/ruta/al/chrome o el de Playwright) y red.
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(here, '..', 'src');
const html = fs.readFileSync(path.join(here, 'fake-twitch.html'));
const exe = process.env.CHROME || (() => {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const d = fs.readdirSync(root).find((x) => x.startsWith('chromium-'));
  return path.join(root, d, 'chrome-linux64', 'chrome');
})();

const ctx = await chromium.launchPersistentContext(path.join(here, 'profile-' + Date.now()), {
  headless: false,
  executablePath: exe,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--lang=en-US'],
  viewport: { width: 1100, height: 700 },
  locale: 'en-US',
});
await ctx.route('https://www.twitch.tv/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));

let failed = 0;
const check = (ok, msg) => { console.log(ok ? '✓' : '✗', msg); if (!ok) failed++; };

const twitch = await ctx.newPage();

async function addFrom(login) {
  await twitch.goto(`https://www.twitch.tv/${login}`);
  await twitch.locator('.dct-btn').waitFor({ timeout: 20000 });
  await twitch.locator('.dct-btn').click();
  await twitch.locator('.dialog').waitFor();
  await twitch.locator('.nav-name', { hasText: 'Multi-view' }).click();
  const add = twitch.locator('.btn.primary');
  await add.waitFor();
  const label = await add.textContent();
  await add.click();
  const notice = twitch.locator('.notice').last();
  await notice.waitFor({ timeout: 10000 });
  return { label, text: (await notice.textContent()).trim() };
}

// 1) Sin Multi-view abierto: se abre uno nuevo con el canal
const pagesBefore = ctx.pages().length;
const first = await addFrom('anthonydeca');
await twitch.waitForTimeout(1500);
const mv = ctx.pages().find((p) => p.url().startsWith('https://decatron.net/multi'));
check(first.label.includes('anthonydeca'), `botón del panel: «${first.label}»`);
check(ctx.pages().length === pagesBefore + 1 && !!mv, `se abrió una pestaña del Multi-view: ${mv ? mv.url() : 'no'}`);
check(/new Multi-view/i.test(first.text), `aviso: «${first.text}»`);

// 2) Con el Multi-view abierto: el segundo canal se suma ahí, sin recargar
await mv.waitForLoadState('domcontentloaded');
await mv.waitForTimeout(4000);                       // que la página y el content script estén listos
await mv.evaluate(() => { window.__sinRecargar = 123; });
const second = await addFrom('pixipnj');
await mv.waitForTimeout(1500);
const marker = await mv.evaluate(() => window.__sinRecargar);
check(/added to Multi-view/i.test(second.text), `aviso: «${second.text}»`);
check(mv.url().includes('anthonydeca') && mv.url().includes('pixipnj'), `la dirección del Multi-view trae los dos canales: ${mv.url()}`);
check(marker === 123, 'la página del Multi-view NO se recargó (los videos no se cortan)');
check((await mv.locator('[data-slot]').count()) === 2, 'el Multi-view muestra 2 casillas');

// 3) Duplicado
const again = await addFrom('pixipnj');
check(/already/i.test(again.text), `aviso de duplicado: «${again.text}»`);
check((await mv.locator('[data-slot]').count()) === 2, 'sigue habiendo 2 casillas');

await twitch.screenshot({ path: path.join(here, 'shot-multiview-panel.png') });
await ctx.close();
console.log(failed ? `${failed} comprobación(es) fallaron` : 'todo bien');
process.exit(failed ? 1 : 0);
