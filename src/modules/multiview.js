// Módulo Multi-view: agrega el canal que estás viendo al Multi-view de decatron.net (varios canales de Twitch y Kick en una
// sola pantalla). Si ya tienes un Multi-view abierto, el canal se suma ahí sin recargarlo; si no, se abre uno nuevo.
(function () {
  const D = window.__decatron;
  const { t, h } = D;
  const kit = D.kit;

  const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M3 3h6v6H3V3Zm8 0h6v6h-6V3ZM3 11h6v6H3v-6Zm8 0h6v6h-6v-6Z"/></svg>`;

  // Mensajes que devuelve el service worker (background.js, multiviewAdd): added | already | opened | limit | error
  const TONE = { added: "ok", opened: "ok", already: "", limit: "warn", error: "warn" };

  const mod = {
    id: "multiview",
    order: 4,
    icon: ICON,
    defaults: { enabled: true },
    name: () => t("mv.name"),
    description: () => t("mv.desc"),
    result: null,

    status() { return { active: false, text: "" }; },

    renderPanel(body) {
      const out = h("div", { class: "sec" });
      const paint = () => {
        out.textContent = "";
        const r = mod.result;
        if (r) out.append(kit.notice(t("mv." + r.mode, { channel: r.channel || "", count: r.count || 0, max: r.max || 0 }), TONE[r.mode] || ""));
      };

      const add = h("button", { class: "btn primary", disabled: !D.channel }, D.channel ? t("mv.add", { channel: D.channel }) : t("mv.noChannel"));
      add.addEventListener("click", async () => {
        add.disabled = true;
        const r = await D.sw({ type: "multiviewAdd", login: D.channel });
        add.disabled = !D.channel;
        mod.result = r && r.mode ? { ...r, channel: D.channel } : { mode: "error" };
        paint();
      });

      const open = h("button", { class: "btn" }, t("mv.open"));
      open.addEventListener("click", async () => {
        const r = await D.sw({ type: "multiviewOpen" });
        mod.result = r && r.ok ? null : { mode: "error" };
        paint();
      });

      body.append(
        kit.section(null, h("p", { class: "muted" }, t("mv.hint"))),
        kit.section(null, h("div", { style: "display:flex;gap:8px;flex-wrap:wrap" }, add, open)),
        out,
      );
      paint();
    },
  };

  D.register(mod);
})();
