// Modo lurk: prueba de punta a punta en un Chromium real con la extensión cargada. Sin red ni cuenta de Twitch: decatron.net/multi
// es una réplica mínima que habla con la extensión por eventos del DOM, twitch.tv es una página vacía y la consulta de «en vivo»
// a gql.twitch.tv se contesta aquí (canaluno en vivo, canaldos no). Comprueba: la marca de la extensión en la página, apagado por
// defecto, solo racha (abre la pestaña silenciada con la marca y la calidad mínima, en ventana aparte; lee la racha del menú de
// puntos y la cierra cuando sube, o a los 30 min), aviso de pestaña sin sesión de Twitch, historial, una vez por directo, completo,
// cierre a mano respetado, ajuste por canal y cierre de todo al cerrar el /multi.
import { chromium } from 'playwright-core';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const here = path.dirname(new URL(import.meta.url).pathname);
const EXT = path.resolve(here, '..', 'src');
const exe = process.env.CHROME || (() => {
  const root = path.join(os.homedir(), '.cache', 'ms-playwright');
  const d = fs.readdirSync(root).find((x) => x.startsWith('chromium-'));
  return path.join(root, d, 'chrome-linux64', 'chrome');
})();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'dct-lurk-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false, executablePath: exe,
  args: ['--headless=new', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--no-sandbox', '--lang=en-US'],
  viewport: { width: 1000, height: 700 }, locale: 'en-US',
});

const MULTI = `<!doctype html><title>multi</title><script>
  window.lurkStates = [];
  addEventListener('decatron-lurk-state', (e) => window.lurkStates.push(JSON.parse(e.detail)));
  window.sync = (channels) => dispatchEvent(new CustomEvent('decatron-lurk-sync', { detail: JSON.stringify({ channels }) }));
  window.set = (patch) => dispatchEvent(new CustomEvent('decatron-lurk-set', { detail: JSON.stringify(patch) }));
  window.last = () => window.lurkStates[window.lurkStates.length - 1] || null;
</script>`;
// Réplica mínima de twitch.tv: el botón del saldo de puntos abre un menú con la tarjeta de la racha (texto real de Twitch).
// window.__streak cambia lo que muestra. Con noSession aparece el botón de iniciar sesión.
const TWITCH = `<!doctype html><title>twitch</title><body>
<script>window.__streak = '0/2';</script>
<video id="v" muted autoplay playsinline width="320" height="180"></video>
<script>const c = document.createElement('canvas'); c.width = 320; c.height = 180; const g = c.getContext('2d'); let n = 0;
setInterval(() => { g.fillStyle = n++ % 2 ? '#333' : '#666'; g.fillRect(0, 0, 320, 180); }, 100);
const v = document.getElementById('v'); v.srcObject = c.captureStream(10); v.play().catch(() => {});</script>
<div data-test-selector="community-points-summary"><button id="pts" onclick="
  const m = document.getElementById('menu');
  if (m) { m.remove(); return; }
  const d = document.createElement('div'); d.id = 'menu';
  d.innerHTML = '<div><p>0</p><p>Racha de visualizaciones</p><p>En curso</p><p>Racha de 2 streams</p><p>' + window.__streak + '</p><p>Conéctate a 2 de los streams consecutivos</p></div>';
  document.body.append(d);">1.2K</button></div>
<!--SESSION-->
<script>document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = document.getElementById('menu'); if (m) m.remove(); } });</script>
</body>`;
let streamId = '111';
await ctx.route('https://decatron.net/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: MULTI }));
let noSession = false;
await ctx.route('https://www.twitch.tv/**', (r) => r.fulfill({ status: 200, contentType: 'text/html',
  body: TWITCH.replace('<!--SESSION-->', noSession ? '<button data-a-target="login-button">Iniciar sesión</button>' : '') }));
await ctx.route('https://gql.twitch.tv/**', (r) => r.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({ data: { users: [{ login: 'canaluno', stream: streamId ? { id: streamId } : null }, { login: 'canaldos', stream: null }] } }),
}));

const sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent('serviceworker');
await sw.evaluate(() => chrome.storage.local.set({ dctLurkTest: true }));
const logCodes = () => sw.evaluate(async () => ((await chrome.storage.local.get('lurkLog')).lurkLog || []).map((e) => e.login + ':' + e.code));
let failed = 0;
const check = (ok, msg) => { console.log(ok ? '✓' : '✗', msg); if (!ok) failed++; };
const lurkTabs = () => sw.evaluate(async () => {
  const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
  return tabs.map((t) => ({ id: t.id, url: t.url, muted: !!(t.mutedInfo && t.mutedInfo.muted), windowId: t.windowId }));
});
const tick = () => sw.evaluate(() => DctLurk.tick());
const clearLive = () => sw.evaluate(() => chrome.storage.session.remove('lurkLive'));
const waitFor = async (fn, ms = 10000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 250)); } return false; };

const page = await ctx.newPage();
await page.goto('https://decatron.net/multi/canaluno/canaldos');
await page.waitForFunction(() => document.documentElement.dataset.decatronLurk === '1', null, { timeout: 10000 });
const ver = await page.evaluate(() => document.documentElement.dataset.decatronExt);
check(!!ver, `la página ve la extensión (versión ${ver}) y el modo lurk`);

// 1) Apagado por defecto: informa el estado y no abre nada
await page.evaluate(() => window.sync(['canaluno', 'canaldos']));
await page.waitForFunction(() => window.last() !== null, null, { timeout: 10000 });
let st = await page.evaluate(() => window.last());
check(st.enabled === false && st.channels.canaluno.status === 'off', 'apagado por defecto: estado «off» y ninguna pestaña');
check((await lurkTabs()).length === 0, 'apagado: no hay pestañas de Twitch');

// 2) Solo racha: abre una pestaña del canal en vivo, silenciada, con la marca, en otra ventana; el canal sin directo queda «offline»
await page.evaluate(() => window.set({ enabled: true, mode: 'streak' }));
check(await waitFor(async () => (await lurkTabs()).length === 1), 'solo racha: se abre una pestaña de Twitch');
await waitFor(async () => { const t = await lurkTabs(); return t[0] && t[0].url && t[0].url.includes('dct-lurk'); });
let tabs = await lurkTabs();
check(tabs[0] && /\/canaluno\?dct-lurk=1$/.test(tabs[0].url), `la pestaña es la del canal en vivo con la marca (${tabs[0] && tabs[0].url})`);
check(tabs[0] && tabs[0].muted, 'la pestaña está silenciada');
const multiWin = await sw.evaluate(async () => (await chrome.tabs.query({ url: 'https://decatron.net/*' }))[0].windowId);
check(tabs[0] && tabs[0].windowId !== multiWin, 'la pestaña va en una ventana aparte');
await page.waitForFunction(() => window.last().channels.canaluno.status === 'open' && window.last().channels.canaldos.status === 'offline', null, { timeout: 10000 });
check(true, 'estado en la página: canaluno «open», canaldos «offline»');

await waitFor(() => ctx.pages().some((p) => p.url().includes('dct-lurk')));
const lurkPage = ctx.pages().find((p) => p.url().includes('dct-lurk'));
if (lurkPage) await lurkPage.waitForLoadState();
// El video arranca con la ventana a la vista y luego la ventana se minimiza sola
check(await waitFor(async () => (await logCodes()).includes('canaluno:playing'), 15000), 'el video de la pestaña arrancó (queda en el historial)');
const winState = async () => sw.evaluate(async () => { const { lurkWindow } = await chrome.storage.session.get('lurkWindow'); try { return (await chrome.windows.get(lurkWindow)).state; } catch { return 'none'; } });
check(await waitFor(async () => (await winState()) === 'minimized', 30000), `con el video andando la ventana de lurk se minimiza (${await winState()})`);
await page.waitForFunction(() => window.last().channels.canaluno.health === 'playing', null, { timeout: 10000 });
check(true, 'la página ve «video reproduciendo»');
const inTab = lurkPage ? await lurkPage.evaluate(() => ({ mark: sessionStorage.getItem('dct-lurk'), q: localStorage.getItem('video-quality') })) : {};
check(inTab.mark === '1' && /160p30/.test(inTab.q || ''), `en la pestaña: marca en sessionStorage y calidad mínima (${inTab.q})`);

// 3) La pestaña lee la racha (0/2) del menú de puntos; cuando sube a 1/2 se cierra sola y queda «done» en este directo
const okRead = await waitFor(async () => (await logCodes()).includes('canaluno:streak_read'), 15000);
check(okRead, 'la racha se lee del menú de puntos (0/2)');
if (!okRead) { console.log('historial:', await logCodes()); console.log('menú:', await lurkPage.evaluate(() => document.body.innerHTML.slice(0, 600))); }
await page.waitForFunction(() => window.last().channels.canaluno.streak && window.last().channels.canaluno.streak.have === 0, null, { timeout: 10000 });
check(true, 'la página ve la racha leída 0/2');
await lurkPage.evaluate(() => { window.__streak = '1/2'; });
check(await waitFor(async () => (await lurkTabs()).length === 0, 20000), 'la racha subió a 1/2: la pestaña se cierra sola');
const codes3 = await logCodes();
check(codes3.includes('canaluno:streak_up') && codes3.includes('canaluno:closed_earned'), `historial: ${codes3.join(', ')}`);
await page.waitForFunction(() => window.last().channels.canaluno.status === 'done' && (window.last().log || []).length > 0, null, { timeout: 10000 });
check(true, 'estado «done» y el historial llega a la página');
await tick();
check((await lurkTabs()).length === 0, 'racha cubierta: no se vuelve a abrir en el mismo directo');

// 3b) Si no ve subir la racha, la cierra a los 30 minutos (cierre por tiempo en el historial)
streamId = '150';
await clearLive(); await tick();
check(await waitFor(async () => (await lurkTabs()).length === 1), 'directo nuevo: se abre para la racha');
await sw.evaluate(async () => {
  const { lurkTabs } = await chrome.storage.session.get('lurkTabs');
  for (const t of Object.values(lurkTabs)) t.openedAt -= 31 * 60 * 1000;
  await chrome.storage.session.set({ lurkTabs });
});
await tick();
check(await waitFor(async () => (await lurkTabs()).length === 0), 'sin ver subir la racha se cierra a los 30 minutos');
check((await logCodes()).includes('canaluno:closed_timeout'), 'el historial dice que se cerró por tiempo');
await page.waitForFunction(() => window.last().channels.canaluno.status === 'timeout', null, { timeout: 10000 });
check(true, 'estado «timeout» en la página');

// 4) Un directo nuevo del mismo canal vuelve a abrir la pestaña de racha
streamId = '222';
await clearLive(); await tick();
check(await waitFor(async () => (await lurkTabs()).length === 1), 'directo nuevo: se abre otra vez para la racha');

// 5) Si la persona cierra la pestaña, no se reabre en ese directo
const [one] = await lurkTabs();
await sw.evaluate((id) => chrome.tabs.remove(id), one.id);
await waitFor(async () => (await lurkTabs()).length === 0);
await tick(); await tick();
check((await lurkTabs()).length === 0, 'cerrada a mano: no se reabre');
await page.waitForFunction(() => window.last().channels.canaluno.status === 'closed', null, { timeout: 10000 });
check(true, 'estado «closed» en la página');

// 6) Completo con un directo nuevo: la pestaña queda abierta aunque pase una hora. Esta vez la pestaña no tiene sesión de
// Twitch: el historial lo avisa
noSession = true;
streamId = '333';
await clearLive();
await page.evaluate(() => window.set({ enabled: true, mode: 'full' }));
check(await waitFor(async () => (await lurkTabs()).length === 1), 'completo: se abre la pestaña');
await sw.evaluate(async () => {
  const { lurkTabs } = await chrome.storage.session.get('lurkTabs');
  for (const t of Object.values(lurkTabs)) t.openedAt -= 60 * 60 * 1000;
  await chrome.storage.session.set({ lurkTabs });
});
await tick();
check((await lurkTabs()).length === 1, 'completo: sigue abierta pasada una hora');
check(await waitFor(async () => (await logCodes()).includes('canaluno:nosession'), 15000), 'pestaña sin sesión de Twitch: queda en el historial');
await page.waitForFunction(() => window.last().channels.canaluno.health === 'nosession', null, { timeout: 10000 });
check(true, 'la página ve «sin sesión de Twitch»');
noSession = false;

// 7) Ajuste por canal: apagado en canaluno cierra su pestaña
await page.evaluate(() => window.set({ login: 'canaluno', channelMode: 'off' }));
check(await waitFor(async () => (await lurkTabs()).length === 0), 'ajuste por canal «apagado»: se cierra su pestaña');
await page.waitForFunction(() => window.last().channels.canaluno.mode === 'off', null, { timeout: 10000 });
await page.evaluate(() => window.set({ login: 'canaluno', channelMode: 'default' }));
check(await waitFor(async () => (await lurkTabs()).length === 1), 'vuelve a «como el resto»: se abre de nuevo');

// 8) Cerrar el /multi cierra las pestañas de lurk
await page.close();
await tick();
check(await waitFor(async () => (await lurkTabs()).length === 0), 'sin /multi abierto no queda ninguna pestaña de lurk');

await ctx.close();
fs.rmSync(profile, { recursive: true, force: true });
console.log(failed ? `${failed} comprobación(es) fallaron` : 'todo bien');
process.exit(failed ? 1 : 0);
