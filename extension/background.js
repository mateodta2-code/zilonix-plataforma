// Issue #210/#213 — relevo entre la pestaña de Mercado Libre/Amazon/
// Temu/AliExpress/Shein/Alibaba (content.js, que lee sold_quantity
// real de un candidato o un listado completo que la persona mandó con
// un clic real) y la pestaña del panel de Investigación de Zilonix
// (marcador-zilonix.js, que lo reenvía a la página con postMessage).
// Un Service Worker de background es el único lugar que puede hablar
// entre pestañas distintas en Manifest V3 — ningún content script
// puede mandarle un mensaje a otro directamente.
//
// A propósito, sin ningún permiso nuevo en manifest.json ("tabs" ni
// "host_permissions"): se manda el mensaje a TODAS las pestañas
// abiertas (chrome.tabs.query({}) no necesita permiso para los ids) y
// se ignora el error de las que no tienen ningún listener — en la
// práctica, solo la pestaña del panel de Investigación (la única con
// marcador-zilonix.js cargado) hace algo con el mensaje. Nunca abre,
// cierra ni navega ninguna pestaña — solo reenvía datos ya leídos.
//
// Issue #213 — TIPOS_RELEVADOS suma "zilonix:listado" ("Importar
// listado") a "zilonix:vendidos" ("Completar vendidos"), que era el
// único tipo que este relevo reenviaba — mismo mecanismo genérico,
// sin tocar nada más de este archivo.
"use strict";

const TIPOS_RELEVADOS = new Set(["zilonix:vendidos", "zilonix:listado"]);

chrome.runtime.onMessage.addListener((mensaje, remitente) => {
  if (!mensaje || !TIPOS_RELEVADOS.has(mensaje.tipo) || !mensaje.payload) return;

  chrome.tabs.query({}, (pestanas) => {
    for (const pestana of pestanas) {
      if (pestana.id == null || pestana.id === remitente.tab?.id) continue; // nunca de vuelta a la misma pestaña de Mercado Libre que lo mandó
      chrome.tabs.sendMessage(pestana.id, mensaje, () => {
        // "Could not establish connection" es el caso normal (pestaña
        // sin marcador-zilonix.js, es decir casi todas) — nunca un
        // error real que haga falta mostrar en ningún lado.
        void chrome.runtime.lastError;
      });
    }
  });
});
