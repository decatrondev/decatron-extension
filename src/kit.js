// Piezas de formulario para los paneles de los módulos (los estilos están en panel.css).
(function () {
  const D = window.__decatron;
  const { h } = D;

  const kit = {
    section(title, ...children) { return h("section", { class: "sec" }, title ? h("h3", null, title) : null, ...children); },

    /** Una fila con título, ayuda y un control a la derecha */
    row(title, hint, control) {
      return h("div", { class: "row" }, h("div", { class: "row-text" }, h("div", { class: "row-title" }, title), hint ? h("div", { class: "row-hint" }, hint) : null), control);
    },

    switch(checked, onChange) {
      return h("label", { class: "switch" }, h("input", { type: "checkbox", checked: !!checked, onchange: (e) => onChange(e.target.checked) }), h("span", { class: "track" }));
    },

    toggleRow(title, hint, checked, onChange) { return kit.row(title, hint, kit.switch(checked, onChange)); },

    select(value, options, onChange) {
      const s = h("select", { onchange: (e) => onChange(e.target.value) }, options.map(([v, label]) => h("option", { value: v }, label)));
      s.value = value == null ? "" : String(value);
      return s;
    },

    slider(title, value, min, max, step, unit, onInput) {
      const val = h("b", null, `${value}${unit}`);
      const input = h("input", { type: "range", min, max, step, value });
      input.value = value;
      input.addEventListener("input", () => { val.textContent = `${input.value}${unit}`; onInput(Number(input.value)); });
      return h("label", { class: "slider" }, h("div", { class: "slider-top" }, h("span", null, title), val), input);
    },

    notice(text, tone) { return h("div", { class: "notice" + (tone ? " " + tone : "") }, text); },
  };

  D.kit = kit;
})();
