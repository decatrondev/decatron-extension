// Diccionario de emotes de un canal: los propios de Decatron más los de 7TV, BTTV y FFZ, normalizados a un
// solo formato y cacheados por capa. Lo usa el service worker (importScripts) y las pruebas de Node.
// Mismo orden de prioridad que el overlay de chat del servidor: lo del canal gana a lo global, entre
// proveedores 7TV > BTTV > FFZ, y los emotes propios de Decatron ganan a todos.
(function (root) {
  const API = "https://decatron.net";
  const GQL_CLIENT_ID = "kimne78kx3ncx6brgo4mv6wki5h1ko"; // el id público que usa la web de Twitch
  const TTL_GLOBAL = 6 * 3600 * 1000;
  const TTL_CHANNEL = 10 * 60 * 1000;
  const TTL_ERROR = 60 * 1000;
  const BTTV_ZERO_WIDTH = new Set(["SoSnowy", "IceCold", "SantaHat", "TopHat", "ReinDeer", "CandyCane", "cvMask", "cvHazmat"]);

  const https = (u) => (u && u.startsWith("//") ? "https:" + u : u);

  async function getJson(fetchFn, url, init) {
    const res = await fetchFn(url, init);
    if (res.status === 404) return null; // un canal sin set o sin cuenta en el proveedor es lo normal
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  // ── Propios de Decatron ───────────────────────────────────────────────────
  function parseOwn(data, provider) {
    const list = (data && data.emotes) || [];
    return list.map((e) => ({ n: e.name, u: (e.urls && (e.urls.x2 || e.urls.x1)) || "", a: !!e.animated, z: !!e.zeroWidth, p: provider || "own" })).filter((e) => e.n && e.u);
  }

  // ── 7TV ───────────────────────────────────────────────────────────────────
  function parseSevenTv(set) {
    const out = [];
    for (const e of (set && set.emotes) || []) {
      if (!e || !e.name || !e.id) continue;
      const data = e.data || {};
      let host = "https://cdn.7tv.app/emote/" + e.id;
      if (data.host && data.host.url) host = https(data.host.url);
      const z = (typeof e.flags === "number" && (e.flags & 1) !== 0) || (typeof data.flags === "number" && (data.flags & 256) !== 0);
      out.push({ n: e.name, u: `${host}/2x.webp`, a: !!data.animated, z, p: "7tv" });
    }
    return out;
  }

  // ── BetterTTV ─────────────────────────────────────────────────────────────
  function parseBttv(list) {
    const out = [];
    for (const e of list || []) {
      if (!e || !e.code || !e.id) continue;
      out.push({ n: e.code, u: `https://cdn.betterttv.net/emote/${e.id}/2x.webp`, a: !!e.animated || e.imageType === "gif", z: BTTV_ZERO_WIDTH.has(e.code), p: "bttv" });
    }
    return out;
  }

  // ── FrankerFaceZ ──────────────────────────────────────────────────────────
  function pickFfzUrl(urls) {
    if (!urls) return null;
    for (const s of ["2", "1", "4"]) if (urls[s]) return https(urls[s]);
    return null;
  }
  function parseFfz(root, defaultSetsOnly) {
    const out = [];
    const sets = (root && root.sets) || {};
    const wanted = defaultSetsOnly && root.default_sets ? new Set(root.default_sets.map(String)) : null;
    for (const [id, set] of Object.entries(sets)) {
      if (wanted && !wanted.has(id)) continue;
      for (const e of set.emoticons || []) {
        if (!e || !e.name) continue;
        const animatedUrl = e.animated ? pickFfzUrl(e.animated) : null;
        const u = animatedUrl || pickFfzUrl(e.urls);
        if (u) out.push({ n: e.name, u, a: !!animatedUrl, z: false, p: "ffz" });
      }
    }
    return out;
  }

  // ── Id del canal (7TV y BTTV lo piden por id de Twitch) ───────────────────
  async function resolveChannelId(fetchFn, login) {
    const res = await fetchFn("https://gql.twitch.tv/gql", {
      method: "POST",
      headers: { "Client-ID": GQL_CLIENT_ID, "Content-Type": "application/json" },
      body: JSON.stringify({ query: "query($login:String!){user(login:$login){id}}", variables: { login } }),
    });
    if (!res.ok) throw new Error("gql " + res.status);
    const j = await res.json();
    return (j && j.data && j.data.user && j.data.user.id) || null;
  }

  /**
   * @param {object} o
   * @param {string} o.login
   * @param {{own:boolean,decatronGlobal:boolean,sevenTv:boolean,bttv:boolean,ffz:boolean,globals:boolean}} o.providers
   * @param {typeof fetch} o.fetch
   * @param {{get:(k:string)=>Promise<any>,set:(k:string,v:any)=>Promise<void>}} [o.cache]
   * @param {(login:string)=>Promise<string|null>} [o.channelId] resolver (cacheada por quien llama)
   * @returns {Promise<{channelId:string|null, entries:object[], errors:Record<string,string>}>}
   */
  async function buildDictionary(o) {
    const { login, providers, fetch: fetchFn } = o;
    const cache = o.cache;
    const errors = {};

    async function layer(key, ttl, load) {
      if (cache) {
        const hit = await cache.get("layer:" + key);
        if (hit && Date.now() - hit.at < hit.ttl) return hit.entries;
      }
      try {
        const entries = await load();
        if (cache) await cache.set("layer:" + key, { at: Date.now(), ttl, entries });
        return entries;
      } catch (e) {
        errors[key] = String(e && e.message || e);
        // Con un proveedor caído se sirve lo último que hubo, y se reintenta en un minuto
        const old = cache ? await cache.get("layer:" + key) : null;
        if (cache) await cache.set("layer:" + key, { at: Date.now(), ttl: TTL_ERROR, entries: (old && old.entries) || [] });
        return (old && old.entries) || [];
      }
    }

    let channelId = null;
    const needId = providers.sevenTv || providers.bttv;
    if (needId) {
      try { channelId = o.channelId ? await o.channelId(login) : await resolveChannelId(fetchFn, login); }
      catch (e) { errors.channelId = String(e && e.message || e); }
    }

    const J = (url) => getJson(fetchFn, url);
    const tasks = []; // de menos a más prioridad: lo último que se aplica gana
    // Los globales de Decatron van primero: solo aparecen si el nombre no lo tomó nadie más
    if (providers.decatronGlobal) tasks.push(layer("gdec", 60 * 1000, async () => parseOwn(await J(`${API}/api/public/global-emotes`), "gdec")));
    if (providers.globals) {
      if (providers.ffz) tasks.push(layer("ffz:global", TTL_GLOBAL, async () => parseFfz(await J("https://api.frankerfacez.com/v1/set/global"), true)));
      if (providers.bttv) tasks.push(layer("bttv:global", TTL_GLOBAL, async () => parseBttv(await J("https://api.betterttv.net/3/cached/emotes/global"))));
      if (providers.sevenTv) tasks.push(layer("7tv:global", TTL_GLOBAL, async () => parseSevenTv(await J("https://7tv.io/v3/emote-sets/global"))));
    }
    if (providers.ffz) tasks.push(layer(`ffz:room:${login}`, TTL_CHANNEL, async () => parseFfz(await J(`https://api.frankerfacez.com/v1/room/${encodeURIComponent(login)}`), false)));
    if (channelId && providers.bttv) {
      tasks.push(layer(`bttv:${channelId}`, TTL_CHANNEL, async () => {
        const j = await J(`https://api.betterttv.net/3/cached/users/twitch/${channelId}`);
        return j ? [...parseBttv(j.sharedEmotes), ...parseBttv(j.channelEmotes)] : [];
      }));
    }
    if (channelId && providers.sevenTv) {
      tasks.push(layer(`7tv:${channelId}`, TTL_CHANNEL, async () => {
        const j = await J(`https://7tv.io/v3/users/twitch/${channelId}`);
        return parseSevenTv(j && j.emote_set);
      }));
    }
    if (providers.own) tasks.push(layer(`own:${login}`, 30 * 1000, async () => parseOwn(await J(`${API}/api/public/emotes/${encodeURIComponent(login)}`))));

    const layers = await Promise.all(tasks);
    const merged = new Map();
    for (const l of layers) for (const e of l) merged.set(e.n, e);
    return { channelId, entries: [...merged.values()], errors };
  }

  root.DctEmoteDict = { buildDictionary, resolveChannelId, parseOwn, parseSevenTv, parseBttv, parseFfz, BTTV_ZERO_WIDTH };
})(typeof self !== "undefined" ? self : globalThis);
