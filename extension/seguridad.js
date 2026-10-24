// Issue #174, revisión de Pablo — funciones puras de seguridad que usa
// content.js antes de meter CUALQUIER texto que venga de la página
// (título, vendedor, vendidos, un link del Top 10...) en el panel o en
// el CSV. Separadas en su propio archivo, sin DOM ni `window` propio
// del sitio, para poder probarlas con vitest sin un navegador real —
// ver extension/seguridad.test.ts.
(function () {
  "use strict";

  // El título de un producto, el nombre de un vendedor, etc. son texto
  // que viene DIRECTO de la página — nunca algo que nosotros
  // escribimos. content.js todavía arma el panel con template strings
  // + innerHTML (no con textContent/createElement en todos los
  // casos), así que cualquier texto de la página tiene que pasar por
  // acá ANTES de entrar a un template, o un título armado a propósito
  // con `<img src=x onerror=...>` se ejecutaría dentro del panel.
  function escaparHtml(texto) {
    if (texto === null || texto === undefined) return "";
    return String(texto)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // El link del Top 10 (listado) sale del `href` real de un <a> de la
  // página — en teoría siempre http(s), pero nunca se confía a ciegas:
  // un `javascript:`, un `data:` o cualquier otro esquema nunca se usa
  // como link. `new URL` además normaliza (percent-encode de
  // caracteres raros en la ruta), así que el resultado ya es seguro
  // para meter en un atributo href. Devuelve null si no es un link
  // http(s) válido — content.js lo muestra como texto suelto, sin link.
  function linkSeguro(valor) {
    if (typeof valor !== "string" || !/^https?:\/\//i.test(valor.trim())) return null;
    try {
      const url = new URL(valor.trim());
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
    } catch {
      return null;
    }
  }

  // Excel/Sheets ejecutan como fórmula cualquier celda que EMPIECE con
  // =, +, -, @ o un tab — un título de producto real puede empezar
  // con cualquiera de esos caracteres (ej. "-50% OFF Combo...") sin
  // que la persona lo haya pedido como fórmula. Se antepone una
  // comilla simple (truco real y documentado de Excel/Sheets: la
  // celda se sigue leyendo igual, pero nunca se evalúa como fórmula).
  function escaparFormulaCsv(texto) {
    return /^[=+\-@\t]/.test(texto) ? `'${texto}` : texto;
  }

  // Una celda de CSV completa: fórmula neutralizada primero, comillas
  // internas escapadas después (CSV estándar: "" adentro de una celda
  // entre comillas), recién ahí se envuelve en comillas.
  function celdaCsv(valor) {
    const textoCrudo = valor === null || valor === undefined ? "" : String(valor);
    const textoSinFormula = escaparFormulaCsv(textoCrudo);
    return `"${textoSinFormula.replace(/"/g, '""')}"`;
  }

  const api = { escaparHtml, linkSeguro, escaparFormulaCsv, celdaCsv };

  // En el navegador (content script real) no existe `module` — este
  // bloque nunca corre ahí, solo sirve para que vitest pueda hacer
  // require()/import de estas mismas funciones sin un navegador.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixSeguridad = api;
  }
})();
