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

  // Issue #210 — "Completar vendidos": reenvía a la página (el React
  // de app/panel/investigacion/PanelDemanda.tsx, que escucha
  // window.addEventListener("message", ...)) lo que extension/
  // background.js mandó desde la pestaña de Mercado Libre donde se
  // abrió el candidato. postMessage con un origin explícito (el de
  // esta misma página, nunca "*") para que ningún otro sitio pueda
  // escucharlo aunque lo intente. El panel vuelve a validar todo el
  // payload igual (nunca confía ciegamente en un mensaje).
  chrome.runtime.onMessage.addListener((mensaje) => {
    if (!mensaje || mensaje.tipo !== "zilonix:vendidos" || !mensaje.payload) return;
    window.postMessage({ fuente: "zilonix-extension", tipo: "vendidos-completados", payload: mensaje.payload }, window.location.origin);
  });
})();
