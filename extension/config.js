// Issue #174 — URL base de la app Zilonix Seller, para el botón
// "Seguir en Zilonix" del panel (extension/lectores/mercadolibre.js).
// Dominio real de producción (confirmado en docs/CHANGELOG.md, tarea
// 2.1) — todavía no se mudó a app.zilonix.com (decisión D7, pendiente
// de ejecutar, ver docs/ESTADO.md). Cuando se ejecute esa mudanza, se
// actualiza ACÁ, en un solo lugar — nunca repetido a mano en cada
// lector.
(function () {
  "use strict";

  const URL_APP = "https://web-production-af270.up.railway.app";
  // Descomentar esta línea (y comentar la de arriba) para probar
  // contra staging antes de repartir una versión nueva:
  // const URL_APP = "https://web-staging-d979.up.railway.app";

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
