// Script de la extensión que corre en decatron.net/multi: recibe del service worker «agrega este canal» y se lo pasa a la
// página como un evento del DOM (la página lo agrega sin recargar, así los videos no se cortan) y devuelve su respuesta.
// Los datos viajan como texto JSON porque la extensión y la página viven en mundos de JavaScript separados.
(function () {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg || msg.type !== "mvAdd") return;
    let done = false;
    const finish = (r) => { if (done) return; done = true; window.removeEventListener("decatron-mv-result", onResult); reply(r); };
    const onResult = (e) => { try { finish(JSON.parse(String(e.detail))); } catch { finish(null); } };
    window.addEventListener("decatron-mv-result", onResult);
    window.dispatchEvent(new CustomEvent("decatron-mv-add", { detail: JSON.stringify({ channel: String(msg.channel || "") }) }));
    setTimeout(() => finish(null), 1500); // la página no contestó: el service worker cambia la dirección en su lugar
    return true; // respuesta asíncrona
  });
})();

// Modo lurk: la página sabe que la extensión está (y que trae el modo lurk) por dos marcas en <html>. Sus canales de Twitch llegan
// con «decatron-lurk-sync» y se repiten al service worker cada 20 s (así se entera si se cierra la página y no se duerme); los
// cambios de ajuste llegan con «decatron-lurk-set» y el estado vuelve a la página como «decatron-lurk-state».
(function () {
  const root = document.documentElement;
  try { root.dataset.decatronExt = chrome.runtime.getManifest().version; } catch { return; }
  root.dataset.decatronLurk = "1";

  let channels = null;
  const send = (msg) => { try { chrome.runtime.sendMessage(msg, () => void chrome.runtime.lastError); } catch { /* extensión recargada */ } };
  const parse = (e) => { try { return JSON.parse(String(e.detail)); } catch { return null; } };

  window.addEventListener("decatron-lurk-sync", (e) => {
    const d = parse(e);
    if (!d || !Array.isArray(d.channels)) return;
    channels = d.channels.map(String);
    send({ type: "lurkSync", channels });
  });
  window.addEventListener("decatron-lurk-set", (e) => {
    const d = parse(e);
    if (d) send({ type: "lurkSet", patch: d });
  });
  setInterval(() => { if (channels) send({ type: "lurkSync", channels }); }, 20000);

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== "lurkState") return;
    window.dispatchEvent(new CustomEvent("decatron-lurk-state", { detail: JSON.stringify(msg.state) }));
  });
})();
