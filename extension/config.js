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

  // Issue #44 (revisión de Pablo sobre el PR #290, LOW) — mismos 2
  // hosts EXACTOS que ORIGENES_SELLER_PERMITIDOS en marcador-zilonix.js
  // (el único que escribe "zilonixUrlApp") y en background.js (que
  // también la revalida para "Importar a Publicar") — nunca una lista
  // distinta en cada archivo. Revalidado acá, de nuevo: aunque hoy solo
  // marcador-zilonix.js escribe esta clave, confiar en que SIEMPRE será
  // así (sin volver a chequear del lado que LEE) es la clase de
  // supuesto que este archivo ya documentó como bug real para URL_APP
  // fijo — nunca una segunda vez.
  const ORIGENES_SELLER_PERMITIDOS = ["https://web-production-af270.up.railway.app", "https://web-staging-d979.up.railway.app"];

  // `api.URL_APP` arranca en producción — comportamiento de siempre —
  // y se actualiza EN EL MISMO OBJETO (nunca se reemplaza `api`
  // entero) si chrome.storage.local trae "zilonixUrlApp" Y ese valor
  // está en la allowlist (ver abajo).
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
        if (typeof datos.zilonixUrlApp === "string" && ORIGENES_SELLER_PERMITIDOS.includes(datos.zilonixUrlApp)) {
          api.URL_APP = datos.zilonixUrlApp;
        }
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
          if (typeof cambios.zilonixUrlApp.newValue === "string" && ORIGENES_SELLER_PERMITIDOS.includes(cambios.zilonixUrlApp.newValue)) {
            api.URL_APP = cambios.zilonixUrlApp.newValue;
          }
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
