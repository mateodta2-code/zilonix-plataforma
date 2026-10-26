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
  };

  chrome.runtime.onMessage.addListener((mensaje) => {
    if (!mensaje || !mensaje.payload) return;
    const tipo = TIPOS_REENVIADOS[mensaje.tipo];
    if (!tipo) return;
    window.postMessage({ fuente: "zilonix-extension", tipo, payload: mensaje.payload }, window.location.origin);
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
})();
