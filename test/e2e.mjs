// Carga la extensión en Chromium y la prueba contra una réplica del DOM del player de Twitch.
// La URL se sirve como https://www.twitch.tv/anthonydeca mediante page.route (la extensión solo
// se inyecta en ese host), y el backend es el real.
import { chromium } from 'playwright-core';
// Requiere: npm i -D playwright-core y un Chromium (CHROME=/ruta/al/chrome o el de Playwright).
// Genera antes el video falso: npm run test:video
import path from 'node:path';
import fs from 'node:fs';

const EXT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'src');
const here = path.dirname(new URL(import.meta.url).pathname);
const html = fs.readFileSync(path.join(here, 'fake-twitch.html'));
const webm = fs.readFileSync(path.join(here, 'fake-stream.webm'));
const durationSec = Number(process.env.DURATION || 60);

const ctx = await chromium.launchPersistentContext(path.join(here, 'profile'), {
  headless: false,
  executablePath: process.env.CHROME || undefined,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required', '--no-sandbox'],
  viewport: { width: 1100, height: 700 },
});
const page = await ctx.newPage();
page.on('console', m => { if (m.text().includes('decatron')) console.log('[page]', m.text()); });
await page.route('https://www.twitch.tv/**', route => {
  const u = new URL(route.request().url());
  if (u.pathname.endsWith('fake-stream.webm')) return route.fulfill({ status: 200, contentType: 'video/webm', body: webm });
  return route.fulfill({ status: 200, contentType: 'text/html', body: html });
});
await page.goto('https://www.twitch.tv/anthonydeca');

const btn = page.locator('.dct-btn');
await btn.waitFor({ timeout: 20000 });
console.log('✓ botón inyectado; hidden =', await page.locator('.dct-btn-wrap').evaluate(e => e.hidden));
await btn.click();
await page.locator('.dct-menu').waitFor();
console.log('✓ menú:', (await page.locator('.dct-row-label').allTextContents()).join(' | '));
await page.screenshot({ path: path.join(here, 'shot-menu.png') });
await page.locator('.dct-row', { hasText: 'English' }).click();
await page.waitForTimeout(1500);
console.log('✓ estado tras elegir English:', await page.evaluate(() => document.querySelector('.dct-btn').className));

// Esperar segmentos (el ingest lo lanza otro proceso) y registrar subtítulos + volumen del video
const seen = [];
const start = Date.now();
let lastCap = '';
while (Date.now() - start < durationSec * 1000) {
  const st = await page.evaluate(() => ({ cap: document.querySelector('.dct-cap-text')?.textContent?.trim() || '', hidden: document.querySelector('.dct-captions')?.hidden, vol: document.querySelector('video').volume.toFixed(2) }));
  if (!st.hidden && st.cap && st.cap !== lastCap) { lastCap = st.cap; seen.push(st); console.log(`[${((Date.now()-start)/1000).toFixed(1)}s] vol=${st.vol} «${st.cap}»`); if (seen.length === 3) await page.screenshot({ path: path.join(here, 'shot-caption.png') }); }
  await page.waitForTimeout(200);
}
console.log('segmentos con subtítulo:', seen.length, '| volumen final:', await page.evaluate(() => document.querySelector('video').volume.toFixed(2)));
await ctx.close();
