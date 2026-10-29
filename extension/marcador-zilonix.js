// Issue #197 — /panel/investigacion necesita saber, del lado del
// navegador, si la persona tiene la extensión de Zilonix instalada,
// para mostrar el badge "Extensión conectada — cobertura real" vs
// "Sin extensión — solo API". Técnica estándar de detección de
// extensión por una web propia: un content script que SOLO corre en
// el dominio de la propia app (ver "matches" en manifest.json) pone
// un atributo en <html> — la página lo lee con JS normal, sin
// necesitar ningún mensaje ni permiso especial.
//
// A propósito en su propio archivo, nunca en content.js: ese archivo
// es el panel flotante sobre Mercado Libre/Amazon/etc., pensado para
// leer la página de un marketplace — esto es lo opuesto, correr sobre
// la propia app de Zilonix, sin tocar nada de la página.
(function () {
  "use strict";
  document.documentElement.setAttribute("data-zilonix-extension", "1");

  // Issue #273 (revisión de Pablo, punto 2) — bug real: "Seguir
  // tienda"/"Seguir en Zilonix" (extension/lectores/mercadolibre.js)
  // siempre abrían producción (extension/config.js, URL_APP fijo),
  // aunque la persona estuviera trabajando contra staging — el único
  // mecanismo para cambiar de ambiente era editar config.js a mano (una
  // línea comentada) y reinstalar la extensión entera. Esta página YA
  // es necesariamente una de Seller real (staging o producción — es
  // justo donde este content script corre, por los `matches` de
  // manifest.json) — se guarda SU origin real en chrome.storage.local
  // ("zilonixUrlApp") para que config.js (cargado en Mercado Libre) lo
  // lea y lo use en lugar del default fijo. Sin ningún permiso/
  // host_permission/match nuevo: chrome.storage.local ya existe
  // (permiso "storage"), y este content script ya corre en esta página
  // por los matches de siempre.
  //
  // Allowlist EXPLÍCITA, nunca "cualquier origin que llegue acá": los
  // MISMOS 2 hosts que ya están en los `matches` de este content
  // script (manifest.json) — nunca un host nuevo sin que el manifest
  // ya lo autorizara primero. `location.origin` lo pone el navegador
  // mismo, nunca algo que la página pueda falsificar desde JS.
  const ORIGENES_SELLER_PERMITIDOS = ["https://web-production-af270.up.railway.app", "https://web-staging-d979.up.railway.app"];
  const CLAVE_URL_APP = "zilonixUrlApp";

  // Puro — separado a propósito, para poder probarlo sin chrome/DOM
  // real (mismo criterio que el resto de la extensión).
  function debeGuardarUrlApp(origin, origenesPermitidos) {
    return Array.isArray(origenesPermitidos) && origenesPermitidos.includes(origin);
  }

  function guardarUrlAppSiCorresponde(origin) {
    if (!debeGuardarUrlApp(origin, ORIGENES_SELLER_PERMITIDOS)) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    try {
      chrome.storage.local.set({ [CLAVE_URL_APP]: origin });
    } catch {
      // Contexto de la extensión invalidado — nunca rompe la página.
    }
  }

  guardarUrlAppSiCorresponde(window.location.origin);

  // Issue #210/#213 — reenvía a la página (el React de
  // app/panel/investigacion/PanelDemanda.tsx, que escucha
  // window.addEventListener("message", ...)) lo que extension/
  // background.js mandó desde la pestaña de Mercado Libre/Amazon/Temu/
  // AliExpress/Shein/Alibaba donde se abrió el candidato o se apretó
  // "Enviar a Zilonix". postMessage con un origin explícito (el de
  // esta misma página, nunca "*") para que ningún otro sitio pueda
  // escucharlo aunque lo intente. El panel vuelve a validar todo el
  // payload igual (nunca confía ciegamente en un mensaje).
  //
  // Issue #213/#225 — TIPOS_REENVIADOS suma "zilonix:listado"
  // ("Importar listado"/"Analizar estilo OS") y "zilonix:resenas-resultado"
  // ("Top 8 reseñas") al único tipo que existía ("zilonix:vendidos",
  // "Completar vendidos") — mismo relevo genérico de
  // extension/background.js, solo se traduce el nombre interno al
  // nombre que ya espera el postMessage en la página.
  const TIPOS_REENVIADOS = {
    "zilonix:vendidos": "vendidos-completados",
    "zilonix:listado": "listado-importado",
    "zilonix:resenas-resultado": "resenas-leidas",
    "zilonix:escaneo-plataforma-resultado": "escaneo-plataforma-importado",
    "zilonix:escaneo-plataforma-captcha": "escaneo-plataforma-captcha",
    // Issue #251 — inventario/vendidos de un competidor, o
    // publicaciones de una tienda seguida, leídos de la página abierta
    // (Mercado Libre nunca los deja ver por la API para un recurso
    // ajeno — confirmado en #250).
    "zilonix:dato-pagina-seguimiento": "dato-pagina-seguimiento",
    // Issue #251 (corrección de Pablo, punto 7) — toda la cola
    // encolada por background.js (chrome.storage.session) de una sola
    // vez, para que EscuchaExtension.tsx la guarde con una sola Server
    // Action y un solo router.refresh().
    "zilonix:cola-seguimiento": "cola-seguimiento",
    // Parte 3, punto D ("Importar a Publicar") — mandado desde una
    // ficha de Mercado Libre (content.js, con un clic real en el botón
    // "Importar a Publicar"); solo hace algo si ESTA pestaña es
    // /panel/publicar (matches ampliado en manifest.json, ver más
    // abajo) — las demás (Investigación/Seguimiento) ignoran este tipo.
    "zilonix:importar-publicar": "importar-publicar",
  };

  chrome.runtime.onMessage.addListener((mensaje, _remitente, sendResponse) => {
    if (!mensaje || !mensaje.payload) return;
    const tipo = TIPOS_REENVIADOS[mensaje.tipo];
    if (!tipo) return;
    window.postMessage({ fuente: "zilonix-extension", tipo, payload: mensaje.payload }, window.location.origin);
    // Issue #251 (corrección de Pablo, punto 7) — ack explícito: sin
    // esto, background.js (vaciarColaSeguimiento) no tiene forma real
    // de saber si esta pestaña de verdad recibió el mensaje antes de
    // vaciar la cola. Síncrono (nunca hace falta `return true` para
    // mantener el canal abierto).
    if (typeof sendResponse === "function") sendResponse({ ok: true });
  });

  // Issue #221/#225 — dirección inversa, PÁGINA -> extensión. Hasta
  // #221 este archivo solo escuchaba a background.js (arriba);
  // "Analizar" necesita lo opuesto: avisarle a la extensión que el
  // clic real de la persona ya autorizó un escaneo acotado de listados
  // de Mercado Libre, o (issue #225) que el clic en "Ver reseñas"
  // autorizó leer el Top 8 con una sola pestaña reutilizada (ver
  // app/panel/investigacion/PanelDemanda.tsx). Mismo chequeo de origin
  // que la otra dirección — nunca se reenvía un mensaje que no sea
  // realmente de esta página.
  const TIPOS_HACIA_EXTENSION = {
    "iniciar-escaneo": "zilonix:iniciar-escaneo",
    "iniciar-resenas": "zilonix:iniciar-resenas",
    "iniciar-escaneo-plataforma": "zilonix:iniciar-escaneo-plataforma",
    // Issue #251 (revisión de Pablo, punto 4) — EscuchaExtension.tsx lo
    // manda una vez al montar /panel/investigacion/seguimiento, para
    // vaciar lo que background.js haya encolado de visitas a Mercado
    // Libre mientras esa pestaña estaba cerrada.
    "pedir-cola-seguimiento": "zilonix:pedir-cola-seguimiento",
    // Issue #251, punto 9 (corrección de Pablo) — "Actualizar todo"
    // (BotonActualizarTodo.tsx) manda los links desde su propio clic
    // real — background.js es quien de verdad los abre (chrome.tabs.create,
    // con su propio allowlist de dominio y tope de 10, nunca solo
    // confiando en lo que mande la página).
    "abrir-seguimientos": "zilonix:abrir-seguimientos",
  };

  window.addEventListener("message", (evento) => {
    if (evento.source !== window || evento.origin !== window.location.origin) return;
    const datos = evento.data;
    if (!datos || datos.fuente !== "zilonix-panel") return;
    const tipo = TIPOS_HACIA_EXTENSION[datos.tipo];
    if (!tipo) return;
    chrome.runtime.sendMessage({ tipo, payload: datos.payload }, () => {
      void chrome.runtime.lastError;
    });
  });

  // Issue #273 (revisión de Pablo, punto 2) — mismo patrón dual que el
  // resto de la extensión: en el navegador real no existe `module`
  // (este bloque nunca corre ahí); en Node (vitest) permite probar
  // debeGuardarUrlApp sin chrome/DOM real.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { debeGuardarUrlApp };
  }
})();
