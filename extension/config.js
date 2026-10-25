// Issue #174 — URL base de la app Zilonix Seller, para el botón
// "Seguir en Zilonix" del panel (extension/lectores/mercadolibre.js).
// Dominio real de producción (confirmado en docs/CHANGELOG.md, tarea
// 2.1) — todavía no se mudó a app.zilonix.com (decisión D7, pendiente
// de ejecutar, ver docs/ESTADO.md). Cuando se ejecute esa mudanza, se
// actualiza ACÁ, en un solo lugar — nunca repetido a mano en cada
// lector.
(function () {
  "use strict";

  // Issue #213 (PR #217) — TEMPORAL para el smoke de Sharel en
  // staging: NUNCA mergear a main así. Revertir a la línea de
  // producción (de abajo, comentada) antes de mergear este PR, o
  // dejar este cambio en un commit aparte que se revierte antes del
  // merge — nunca mezclado en silencio con el resto del PR.
  const URL_APP = "https://web-staging-d979.up.railway.app";
  // Producción (default real — descomentar y comentar la de arriba
  // antes de mergear/repartir una versión nueva):
  // const URL_APP = "https://web-production-af270.up.railway.app";

  const api = { URL_APP };

  // Mismo patrón dual que extension/seguridad.js — en el navegador
  // real no existe `module` (este bloque nunca corre ahí); en Node
  // (vitest, o el require() de otro lector para sus propias pruebas)
  // no existe `window`.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixConfig = api;
  }
})();
