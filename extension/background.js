// Issue #210 — "Completar vendidos": relevo entre la pestaña de
// Mercado Libre (content.js, que lee sold_quantity real del candidato
// que la persona abrió) y la pestaña del panel de Investigación de
// Zilonix (marcador-zilonix.js, que lo reenvía a la página con
// postMessage). Un Service Worker de background es el único lugar que
// puede hablar entre pestañas distintas en Manifest V3 — ningún
// content script puede mandarle un mensaje a otro directamente.
//
// A propósito, sin ningún permiso nuevo en manifest.json ("tabs" ni
// "host_permissions"): se manda el mensaje a TODAS las pestañas
// abiertas (chrome.tabs.query({}) no necesita permiso para los ids) y
// se ignora el error de las que no tienen ningún listener — en la
// práctica, solo la pestaña del panel de Investigación (la única con
// marcador-zilonix.js cargado) hace algo con el mensaje. Nunca abre,
// cierra ni navega ninguna pestaña — solo reenvía datos ya leídos.
"use strict";

chrome.runtime.onMessage.addListener((mensaje, remitente) => {
  if (!mensaje || mensaje.tipo !== "zilonix:vendidos" || !mensaje.payload) return;

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
