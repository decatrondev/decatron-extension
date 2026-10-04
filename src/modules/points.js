// Módulo de puntos de canal: todavía no hace nada. Está registrado para que el panel muestre que viene y para que
// el resto de la extensión ya cuente con él (el auto-pick del bonus de puntos será su primera función).
(function () {
  const D = window.__decatron;
  const { t } = D;

  D.register({
    id: "points",
    order: 3,
    soon: true,
    icon: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm.9 11.6V15H9.2v-1.4a2.7 2.7 0 0 1-1.9-1.5l1.4-.8c.3.6.8.9 1.4.9.5 0 .9-.2.9-.6 0-.4-.3-.6-1.2-.9-1.2-.4-2-.9-2-2 0-.9.6-1.6 1.6-1.8V5h1.7v1.4c.7.1 1.2.5 1.6 1.1l-1.2.8c-.2-.4-.5-.6-1-.6-.4 0-.7.2-.7.5s.3.5 1.2.8c1.2.4 2 .9 2 2 0 1-.7 1.7-1.9 2Z"/></svg>`,
    defaults: { enabled: false },
    name: () => t("pt.name"),
    description: () => t("pt.desc"),
  });
})();
