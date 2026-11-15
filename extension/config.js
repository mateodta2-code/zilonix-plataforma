// Issue #174 — URL base de la app Zilonix Seller, para el botón
// "Seguir en Zilonix" del panel (extension/lectores/mercadolibre.js).
// Producción = https://seller.zilonix.com (issue #414; antes la URL de
// Railway). Se actualiza ACÁ, en un solo lugar — nunca repetido a mano
// en cada lector.
//
// Issue #414 — además lee la configuración remota que background.js
// descarga de GET /api/extension/config y guarda ya validada en
// chrome.storage.local ("zilonixConfigRemota"): interruptores y
// textos. Si no hay nada guardado, o falla algo, quedan los valores
// por defecto SEGUROS de abajo (Alibaba apagado).
(function () {
  "use strict";

  const URL_APP_PRODUCCION = "https://seller.zilonix.com";

  // Issue #44 (revisión de Pablo sobre el PR #290, LOW) — mismos 2
  // hosts EXACTOS que ORIGENES_SELLER_PERMITIDOS en marcador-zilonix.js
  // (el único que escribe "zilonixUrlApp") y en background.js (que
  // también la revalida para "Importar a Publicar") — nunca una lista
  // distinta en cada archivo. Revalidado acá, de nuevo: aunque hoy solo
  // marcador-zilonix.js escribe esta clave, confiar en que SIEMPRE será
  // así (sin volver a chequear del lado que LEE) es la clase de
  // supuesto que este archivo ya documentó como bug real para URL_APP
  // fijo — nunca una segunda vez.
  // La URL vieja de Railway se conserva SOLO como origen permitido
  // (quien aún la tenga abierta sigue funcionando); ya no es el default.
  const ORIGENES_SELLER_PERMITIDOS = ["https://seller.zilonix.com", "https://web-staging-d979.up.railway.app", "https://web-production-af270.up.railway.app"];

  // Valores por defecto seguros si la configuración remota no llega o
  // viene mal. Mismas claves que lib/extension/configuracion.ts.
  const INTERRUPTORES_DEFECTO = { alibaba: false };
  const TEXTOS_DEFECTO = { avisoSinSesion: "Inicia sesión en Zilonix Seller para analizar" };
  const MAX_LARGO_TEXTO = 200;

  // Única validación de la configuración remota (la usa también
  // background.js, antes de guardarla): solo claves conocidas, solo
  // booleanos en interruptores, solo strings cortos en textos, y
  // `urlApp` solo si está en la allowlist. Nunca confía en la forma.
  function sanearConfigRemota(cruda) {
    const limpia = { interruptores: { ...INTERRUPTORES_DEFECTO }, textos: { ...TEXTOS_DEFECTO }, urlApp: null };
    if (!cruda || typeof cruda !== "object") return limpia;
    if (cruda.interruptores && typeof cruda.interruptores === "object") {
      for (const clave of Object.keys(INTERRUPTORES_DEFECTO)) {
        if (typeof cruda.interruptores[clave] === "boolean") limpia.interruptores[clave] = cruda.interruptores[clave];
      }
    }
    if (cruda.textos && typeof cruda.textos === "object") {
      for (const clave of Object.keys(TEXTOS_DEFECTO)) {
        const t = cruda.textos[clave];
        if (typeof t === "string" && t.trim() && t.length <= MAX_LARGO_TEXTO) limpia.textos[clave] = t;
      }
    }
    if (typeof cruda.urlApp === "string" && ORIGENES_SELLER_PERMITIDOS.includes(cruda.urlApp)) limpia.urlApp = cruda.urlApp;
    return limpia;
  }

  // `api.URL_APP` arranca en producción — comportamiento de siempre —
  // y se actualiza EN EL MISMO OBJETO (nunca se reemplaza `api`
  // entero) si chrome.storage.local trae "zilonixUrlApp" Y ese valor
  // está en la allowlist (ver abajo).
  const api = {
    URL_APP: URL_APP_PRODUCCION,
    interruptores: { ...INTERRUPTORES_DEFECTO },
    textos: { ...TEXTOS_DEFECTO },
    sanearConfigRemota,
    // Un interruptor desconocido siempre es `false` (apagado).
    interruptor(clave) {
      return api.interruptores[clave] === true;
    },
    texto(clave) {
      return typeof api.textos[clave] === "string" ? api.textos[clave] : TEXTOS_DEFECTO[clave] || "";
    },
  };
  // `urlApp` remota: solo se usa si la persona NO tiene una pestaña de
  // Seller que ya fijó el ambiente real ("zilonixUrlApp" manda siempre).
  let urlAppDePestana = false;

  function aplicarConfigRemota(cruda) {
    const c = sanearConfigRemota(cruda);
    api.interruptores = c.interruptores;
    api.textos = c.textos;
    if (c.urlApp && !urlAppDePestana) api.URL_APP = c.urlApp;
  }

  function leerConfigRemotaGuardada() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.get({ zilonixConfigRemota: null }, (datos) => {
        if (datos && datos.zilonixConfigRemota) aplicarConfigRemota(datos.zilonixConfigRemota);
      });
    } catch {
      // Contexto invalidado — sigue con los valores por defecto.
    }
  }

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
          urlAppDePestana = true;
        }
        // Después de zilonixUrlApp, para que la pestaña real gane.
        leerConfigRemotaGuardada();
      });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe nada, sigue con producción.
    }
    if (chrome.storage.onChanged && chrome.storage.onChanged.addListener) {
      try {
        chrome.storage.onChanged.addListener((cambios, area) => {
          if (area === "local" && cambios.zilonixConfigRemota && cambios.zilonixConfigRemota.newValue) {
            aplicarConfigRemota(cambios.zilonixConfigRemota.newValue);
          }
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
