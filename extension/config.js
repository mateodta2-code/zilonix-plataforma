// Issue #174 — URL base de la app Zilonix Seller, para el botón
// "Seguir en Zilonix" del panel (extension/lectores/mercadolibre.js).
// Dominio real de producción (confirmado en docs/CHANGELOG.md, tarea
// 2.1) — todavía no se mudó a app.zilonix.com (decisión D7, pendiente
// de ejecutar, ver docs/ESTADO.md). Cuando se ejecute esa mudanza, se
// actualiza ACÁ, en un solo lugar — nunca repetido a mano en cada
// lector.
(function () {
  "use strict";

  const URL_APP_PRODUCCION = "https://web-production-af270.up.railway.app";

  // `api.URL_APP` arranca en producción — comportamiento de siempre —
  // y se actualiza EN EL MISMO OBJETO (nunca se reemplaza `api`
  // entero) si chrome.storage.local trae "zilonixUrlApp" (ver abajo).
  const api = { URL_APP: URL_APP_PRODUCCION };

  // Issue #273 (revisión de Pablo, punto 2) — bug real: "Seguir
  // tienda"/"Seguir en Zilonix" (extension/lectores/mercadolibre.js,
  // construirLinkSeguirProducto/construirLinkSeguirTienda) siempre
  // abrían producción, aunque Mateo estuviera trabajando contra
  // staging — el único mecanismo para cambiar de ambiente era editar
  // ESTE archivo a mano (una línea comentada, ya quitada) y reinstalar
  // la extensión entera. Ahora extension/marcador-zilonix.js (corre en
  // /panel/* de Seller, staging o producción) guarda el origin REAL de
  // la pestaña de Seller que la persona ya tiene abierta en
  // chrome.storage.local ("zilonixUrlApp") — acá SOLO se lee esa
  // clave, nunca se escribe. mercadolibre.js lee `CONFIG.URL_APP` en
  // el momento de construir cada link (nunca lo captura aparte en una
  // variable propia) — mutar esta única propiedad alcanza, sin tocar
  // ningún otro archivo ni cambiar ninguna firma de función.
  //
  // Sin chrome.storage.local disponible (vitest, o esta extensión
  // corriendo en un sitio sin el permiso — nunca debería pasar, pero
  // nunca revienta igual), queda en el default de producción de
  // siempre.
  function leerUrlAppGuardada() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.get({ zilonixUrlApp: null }, (datos) => {
        if (typeof datos.zilonixUrlApp === "string") api.URL_APP = datos.zilonixUrlApp;
      });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe nada, sigue con producción.
    }
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      try {
        chrome.storage.onChanged.addListener((cambios, area) => {
          if (area !== "local" || !cambios.zilonixUrlApp) return;
          // "Seguir en Zilonix"/"Seguir tienda" en caliente: si la
          // persona abre staging en otra pestaña mientras esta ficha de
          // Mercado Libre ya está abierta, el próximo clic ya usa el
          // ambiente nuevo, sin recargar nada.
          if (typeof cambios.zilonixUrlApp.newValue === "string") api.URL_APP = cambios.zilonixUrlApp.newValue;
        });
      } catch {
        // ídem arriba, nunca revienta
      }
    }
  }
  leerUrlAppGuardada();

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
