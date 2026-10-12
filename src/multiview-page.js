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
