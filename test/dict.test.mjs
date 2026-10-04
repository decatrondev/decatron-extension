// Prueba del diccionario de emotes contra los servicios reales (necesita red).
import '../src/emote-dict.js';
const { buildDictionary, parseSevenTv, parseBttv, parseFfz, parseOwn } = globalThis.DctEmoteDict;
let fails = 0;
const check = (n, ok) => { console.log((ok ? 'OK   ' : 'FAIL ') + n); if (!ok) fails++; };

// Parsers con muestras de la forma de cada API
const s7 = parseSevenTv({ emotes: [
  { id: 'A1', name: 'Wide', flags: 0, data: { animated: true, flags: 0, host: { url: '//cdn.7tv.app/emote/A1' } } },
  { id: 'A2', name: 'Hat', flags: 1, data: { animated: false, flags: 0 } },
  { id: 'A3', name: 'Hat2', flags: 0, data: { animated: false, flags: 256 } },
  { name: 'SinId' }] });
check('7TV: url 2x.webp, animado y zero-width por flags de set o de emote', s7.length === 3 && s7[0].u === 'https://cdn.7tv.app/emote/A1/2x.webp' && s7[0].a && s7[1].z && s7[2].z && !s7[0].z);
const bt = parseBttv([{ id: 'b1', code: 'KEKW', imageType: 'png' }, { id: 'b2', code: 'cvHazmat', imageType: 'gif' }]);
check('BTTV: url, gif animado y lista de zero-width', bt[0].u === 'https://cdn.betterttv.net/emote/b1/2x.webp' && !bt[0].a && bt[1].a && bt[1].z);
const ff = parseFfz({ default_sets: [3], sets: { 3: { emoticons: [{ name: 'ZrehplaR', urls: { 1: '//cdn.ffz/1', 2: '//cdn.ffz/2' } }] }, 9: { emoticons: [{ name: 'Otro', urls: { 1: '//x' } }] } } }, true);
check('FFZ global: solo los sets por defecto, urls con https', ff.length === 1 && ff[0].u === 'https://cdn.ffz/2');
check('Propios: toma la url 2x y el zero-width', parseOwn({ emotes: [{ name: 'Mio', animated: true, zeroWidth: true, urls: { x1: 'a', x2: 'b' } }] })[0].u === 'b');

// Servicios reales
const store = new Map();
const cache = { get: async (k) => store.get(k), set: async (k, v) => { store.set(k, v); } };
let t0 = Date.now();
const d = await buildDictionary({ login: 'pixipnj', providers: { own: true, sevenTv: true, bttv: true, ffz: true, globals: true }, fetch, cache });
console.log(`pixipnj: ${d.entries.length} emotes en ${Date.now() - t0} ms · id ${d.channelId} · ${Object.keys(d.errors).length ? 'errores ' + JSON.stringify(d.errors) : 'sin errores'}`);
const by = {}; d.entries.forEach(e => by[e.p] = (by[e.p] || 0) + 1); console.log('por proveedor:', JSON.stringify(by));
check('resuelve el id del canal', d.channelId === '1093435195');
check('trae 7TV, BTTV y FFZ', ['7tv', 'bttv', 'ffz'].every(p => by[p] > 0));
check('urls absolutas https y sin nombres repetidos', d.entries.every(e => e.u.startsWith('https://')) && new Set(d.entries.map(e => e.n)).size === d.entries.length);
t0 = Date.now();
await buildDictionary({ login: 'pixipnj', providers: { own: false, sevenTv: true, bttv: true, ffz: true, globals: true }, fetch, cache, channelId: async () => '1093435195' });
console.log(`segunda vez (capas en caché): ${Date.now() - t0} ms`);
check('la segunda vez sale de caché (rápido)', Date.now() - t0 < 300);
const only = await buildDictionary({ login: 'pixipnj', providers: { own: false, sevenTv: false, bttv: false, ffz: true, globals: false }, fetch, cache: null });
check('solo FFZ sin globales no resuelve el id ni trae lo demás', only.channelId === null && only.entries.every(e => e.p === 'ffz'));
const none = await buildDictionary({ login: 'canal_que_no_existe_zz9', providers: { own: true, sevenTv: true, bttv: true, ffz: true, globals: false }, fetch, cache: null });
check('un canal inexistente no rompe', none.entries.length === 0);
// Un proveedor caído no tumba el resto
const flaky = (url, init) => String(url).includes('betterttv') ? Promise.reject(new Error('caído')) : fetch(url, init);
const f2 = await buildDictionary({ login: 'pixipnj', providers: { own: false, sevenTv: true, bttv: true, ffz: false, globals: true }, fetch: flaky, cache: null, channelId: async () => '1093435195' });
check('con BTTV caído salen los de 7TV y queda el error anotado', f2.entries.some(e => e.p === '7tv') && !f2.entries.some(e => e.p === 'bttv') && Object.keys(f2.errors).some(k => k.startsWith('bttv')));
console.log(fails === 0 ? 'TODO OK' : `${fails} FALLAS`);
process.exit(fails ? 1 : 0);
