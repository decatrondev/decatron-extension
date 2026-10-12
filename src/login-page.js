// Script de la extensión que corre SOLO en decatron.net/extension/login: la página le entrega el token de espectador con
// window.postMessage y aquí se guarda en chrome.storage.local. Ninguna otra página de decatron.net dispara este script, y se
// comprueba que el mensaje venga de la propia página (no de un marco ajeno) con la forma esperada. El token solo identifica a la
// persona ante la traducción en vivo: no da acceso a su panel.
(function () {
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (e.source !== window || e.origin !== location.origin || !d || d.type !== "dct-viewer-token") return;
    const token = typeof d.token === "string" ? d.token : "";
    const login = typeof d.login === "string" ? d.login.slice(0, 60) : "";
    const expiresAt = Number(d.expiresAt);
    if (!token || token.length > 4000 || token.split(".").length !== 3 || !Number.isFinite(expiresAt) || expiresAt * 1000 < Date.now()) return;
    chrome.storage.local.set({ dctViewer: { token, login, expiresAt, at: Date.now() } }, () => {
      window.postMessage({ type: "dct-viewer-token-ack" }, location.origin);
    });
  });
})();
