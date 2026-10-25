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
// cierra ni navega ninguna pestaña por su cuenta fuera del escaneo de
// abajo (issue #221) — y ESE escaneo nunca arranca sin que la persona
// haya hecho clic en "Analizar" (ver más abajo).
"use strict";

const TIPOS_RELEVADOS = new Set(["zilonix:vendidos", "zilonix:listado"]);

// Issue #221 — "Analizar estilo OS": orquesta el escaneo acotado de
// listados REALES de Mercado Libre que arranca con "Analizar". Todo
// esto corre a partir de UN SOLO clic real (ver app/panel/investigacion/
// FormularioAnalizar.tsx + analizarClic.ts, que autoriza el mensaje
// "zilonix:iniciar-escaneo" que dispara todo esto) — nunca se repite
// solo, nunca abre más pestañas de las que la persona autorizó con ese
// clic.
//
// Limitación conocida, documentada a propósito: un Service Worker de
// Manifest V3 puede reciclarse si queda inactivo (~30s sin eventos).
// Un escaneo de 4 variantes con 15s de margen cada una normalmente lo
// mantiene vivo (cada chrome.tabs.create/onMessage reinicia el
// contador de inactividad) — pero si Chrome lo recicla a mitad de
// camino, el escaneo en curso se pierde (las pestañas que ya estén
// abiertas igual se cierran solas por el timeout del lado de la
// pestaña... no, ESE timeout también vive en este mismo Service
// Worker). Mientras no haya una alternativa con estado persistido
// (chrome.storage.session), el peor caso es "el escaneo no avisa que
// terminó" — el panel tiene su propio timeout del lado del cliente
// (PanelDemanda.tsx) para no quedarse mostrando "Escaneando..." para
// siempre.
const TOPE_TERMINOS_ESCANEO = 5; // issue #225 — término + hasta 4 variantes (IA + respaldo de reglas) = 5 queries, nunca más
const TOPE_PRODUCTOS_POR_VARIANTE = 20; // "lee ~20" — el tope real vive en content.js (TOPE_PRODUCTOS_ENVIO_LISTADO), este es solo documentación
const TIMEOUT_POR_VARIANTE_MS = 15000; // si una pestaña nunca contesta (bloqueo, captcha, red lenta), no se cuelga para siempre
void TOPE_PRODUCTOS_POR_VARIANTE;

// Un escaneo activo por pestaña del PANEL que lo pidió (nunca por
// pestaña de listado) — admite, en teoría, más de una pestaña de
// Investigación escaneando a la vez sin pisarse.
const escaneosActivos = new Map(); // tabIdPanel -> { terminos, indice, resultados, tabIdActual, timeoutId }

function urlListadoMl(termino) {
  // Issue #221 — formato real de Mercado Libre Colombia para un
  // listado por texto: palabras separadas por guión, nunca espacios
  // codificados (confirmado por el formato que el propio pedido dio:
  // "listado.mercadolibre.com.co/{término}"). El marcador
  // "_zilonix_escaneo=1" (propio, nunca de Mercado Libre) es lo que
  // content.js usa para saber que esta pestaña puntual la abrió el
  // escaneo automático — nunca una persona a mano.
  const limpio = termino.trim().toLowerCase().replace(/\s+/g, "-");
  return `https://listado.mercadolibre.com.co/${encodeURIComponent(limpio)}?_zilonix_escaneo=1`;
}

function iniciarEscaneo(tabIdPanel, terminosCrudos) {
  // Si ya había un escaneo en curso para esta misma pestaña del panel
  // (ej. doble submit), se descarta el viejo — nunca dos escaneos
  // pisándose las pestañas entre sí.
  const anterior = escaneosActivos.get(tabIdPanel);
  if (anterior) {
    clearTimeout(anterior.timeoutId);
    if (anterior.tabIdActual != null) chrome.tabs.remove(anterior.tabIdActual, () => void chrome.runtime.lastError);
  }

  const terminos = terminosCrudos
    .filter((t) => typeof t === "string" && t.trim())
    .slice(0, TOPE_TERMINOS_ESCANEO);
  if (!terminos.length) return;

  escaneosActivos.set(tabIdPanel, { terminos, indice: 0, resultados: [], tabIdActual: null, timeoutId: null });
  abrirSiguienteVariante(tabIdPanel);
}

function abrirSiguienteVariante(tabIdPanel) {
  const estado = escaneosActivos.get(tabIdPanel);
  if (!estado) return;

  if (estado.indice >= estado.terminos.length) {
    finalizarEscaneo(tabIdPanel);
    return;
  }

  const termino = estado.terminos[estado.indice];
  // "activa" (ver issue #221, punto 3) — chrome.tabs.create con
  // active:true, nunca una pestaña de fondo oculta.
  chrome.tabs.create({ url: urlListadoMl(termino), active: true }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) {
      // No se pudo abrir esta variante (ej. Chrome bloqueó la
      // creación) — se sigue con la próxima, nunca se cuelga el
      // escaneo completo por una sola variante.
      estado.indice++;
      abrirSiguienteVariante(tabIdPanel);
      return;
    }
    estado.tabIdActual = tab.id;
    estado.timeoutId = setTimeout(() => cerrarVarianteYSeguir(tabIdPanel, tab.id, null), TIMEOUT_POR_VARIANTE_MS);
  });
}

function cerrarVarianteYSeguir(tabIdPanel, tabIdVariante, resultado) {
  const estado = escaneosActivos.get(tabIdPanel);
  // Si ya se cerró/avanzó (ej. la respuesta real y el timeout llegaron
  // casi juntos), no se vuelve a procesar dos veces la misma variante.
  if (!estado || estado.tabIdActual !== tabIdVariante) return;

  clearTimeout(estado.timeoutId);
  if (resultado) estado.resultados.push(resultado);
  estado.indice++;
  estado.tabIdActual = null;
  // Issue #221, punto 7 — default: nunca sigue abierta ninguna
  // pestaña de la variante después de leerla. Nunca abre la
  // publicación individual de ningún candidato encontrado acá.
  chrome.tabs.remove(tabIdVariante, () => void chrome.runtime.lastError);
  abrirSiguienteVariante(tabIdPanel);
}

function finalizarEscaneo(tabIdPanel) {
  const estado = escaneosActivos.get(tabIdPanel);
  escaneosActivos.delete(tabIdPanel);
  if (!estado) return;

  const productos = estado.resultados.flatMap((r) => (Array.isArray(r.productos) ? r.productos : []));
  // Issue #221 — mismo tipo "zilonix:listado" que ya entiende el
  // panel (issue #213, "Importar listado") — con `origen:
  // "escaneo-analizar"` para que PanelDemanda.tsx lo fusione directo,
  // sin pedir otra vez "Importar/Fusionar/Reemplazar" (ese paso extra
  // tiene sentido para un listado manual que apareció de la nada;
  // acá la persona YA autorizó todo con el clic de Analizar).
  chrome.tabs.sendMessage(
    tabIdPanel,
    { tipo: "zilonix:listado", payload: { plataforma: "Mercado Libre Colombia", url: "", productos, origen: "escaneo-analizar" } },
    () => void chrome.runtime.lastError
  );
  // Deja a la persona de vuelta en el panel, no en la última pestaña
  // de listado que se cerró.
  chrome.tabs.update(tabIdPanel, { active: true }, () => void chrome.runtime.lastError);
}

// Issue #225 — "Top 8 reseñas": mismo patrón confirmado en producción
// en zilonix-os-web (chrome-extension-busqueda/background.js,
// leerResenasTop/leerResenaDeUnaPdp) — UNA SOLA pestaña de fondo
// reutilizada (chrome.tabs.update con una url nueva cada vez, nunca
// chrome.tabs.create por cada publicación: son hasta 8 navegaciones,
// no 8 pestañas), con una pausa chica entre cada una. El timeout de
// AFUERA (TIEMPO_MAX_RESENA_MS) siempre tiene que ganarle con margen
// al que content.js espera adentro (ver lector.leerResenas +
// reescanearConRetardo en content.js) — nunca ir pegados, mismo
// comentario que ya dejó Cowork en el código real de OS.
const TIEMPO_MAX_RESENA_MS = 14000;
const PAUSA_ENTRE_PDPS_MS = 500;
const TOPE_ITEMS_RESENAS = 8; // "Top 8" del pedido — nunca más

// Una lectura de reseñas activa por pestaña del PANEL que la pidió —
// mismo criterio que escaneosActivos arriba.
const resenasActivas = new Map(); // tabIdPanel -> { tabId, items, indice, resultado, timeoutId }

function iniciarLecturaResenas(tabIdPanel, itemsCrudos) {
  const anterior = resenasActivas.get(tabIdPanel);
  if (anterior) {
    clearTimeout(anterior.timeoutId);
    if (anterior.tabId != null) chrome.tabs.remove(anterior.tabId, () => void chrome.runtime.lastError);
    resenasActivas.delete(tabIdPanel);
  }

  const items = (itemsCrudos || [])
    .filter((it) => it && typeof it.itemId === "string" && typeof it.link === "string")
    .slice(0, TOPE_ITEMS_RESENAS);
  if (!items.length) return;

  // Pestaña de FONDO (active:false) a propósito — a diferencia del
  // escaneo de listados (issue #221, que sí pide "activa"), el pedido
  // de "Top 8 reseñas" no lo exige y OS tampoco lo hace así: 8
  // navegaciones seguidas en una pestaña visible parpadearían sin
  // ningún beneficio real para la persona.
  chrome.tabs.create({ url: "about:blank", active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) return;
    resenasActivas.set(tabIdPanel, { tabId: tab.id, items, indice: 0, resultado: {}, timeoutId: null });
    leerSiguienteResena(tabIdPanel);
  });
}

function leerSiguienteResena(tabIdPanel) {
  const estado = resenasActivas.get(tabIdPanel);
  if (!estado) return;

  if (estado.indice >= estado.items.length) {
    finalizarLecturaResenas(tabIdPanel);
    return;
  }

  const item = estado.items[estado.indice];
  chrome.tabs.update(estado.tabId, { url: item.link }, () => {
    if (chrome.runtime.lastError) {
      avanzarLecturaResena(tabIdPanel, null);
      return;
    }
    estado.timeoutId = setTimeout(() => avanzarLecturaResena(tabIdPanel, null), TIEMPO_MAX_RESENA_MS);
  });
}

function avanzarLecturaResena(tabIdPanel, resena) {
  const estado = resenasActivas.get(tabIdPanel);
  if (!estado) return;
  clearTimeout(estado.timeoutId);
  const item = estado.items[estado.indice];
  // resena == null es un resultado válido (timeout, o la PDP no trajo
  // reviews_capability_v3) — nunca se inventa una reseña en su lugar,
  // simplemente ese itemId no entra al resultado final.
  if (resena && item) estado.resultado[item.itemId] = resena;
  estado.indice++;
  setTimeout(() => leerSiguienteResena(tabIdPanel), PAUSA_ENTRE_PDPS_MS);
}

function finalizarLecturaResenas(tabIdPanel) {
  const estado = resenasActivas.get(tabIdPanel);
  resenasActivas.delete(tabIdPanel);
  if (!estado) return;

  chrome.tabs.remove(estado.tabId, () => void chrome.runtime.lastError);
  chrome.tabs.sendMessage(
    tabIdPanel,
    { tipo: "zilonix:resenas-resultado", payload: { resenasPorItemId: estado.resultado } },
    () => void chrome.runtime.lastError
  );
}

chrome.runtime.onMessage.addListener((mensaje, remitente) => {
  if (!mensaje) return;

  if (mensaje.tipo === "zilonix:iniciar-escaneo") {
    if (!remitente.tab?.id) return;
    const terminos = Array.isArray(mensaje.payload?.terminos) ? mensaje.payload.terminos : [];
    iniciarEscaneo(remitente.tab.id, terminos);
    return;
  }

  if (mensaje.tipo === "zilonix:escaneo-resultado") {
    // Viene de una pestaña de listado que ESTE Service Worker abrió —
    // se busca a qué escaneo (de qué pestaña del panel) pertenece por
    // tabIdActual, nunca por remitente.tab.id solo (content.js ni
    // sabe qué pestaña de panel lo originó).
    for (const [tabIdPanel, estado] of escaneosActivos) {
      if (estado.tabIdActual === remitente.tab?.id) {
        cerrarVarianteYSeguir(tabIdPanel, remitente.tab.id, mensaje.payload);
        return;
      }
    }
    return; // ninguna variante activa esperaba esto (ej. llegó tarde, después del timeout) — nunca rompe nada
  }

  if (mensaje.tipo === "zilonix:iniciar-resenas") {
    if (!remitente.tab?.id) return;
    iniciarLecturaResenas(remitente.tab.id, mensaje.payload?.items);
    return;
  }

  if (mensaje.tipo === "zilonix:resena") {
    // Mismo criterio que "zilonix:escaneo-resultado" — content.js
    // manda esto SIEMPRE que confirma una reseña en cualquier PDP
    // (igual que ya hace con "zilonix:vendidos"), nunca solo durante
    // una lectura activa. Solo importa si esta pestaña es justo la
    // que una lectura de reseñas está conduciendo ahora mismo —
    // cualquier otra (ej. una pestaña de "Completar vendidos") se
    // ignora sin romper nada.
    for (const [tabIdPanel, estado] of resenasActivas) {
      if (estado.tabId === remitente.tab?.id) {
        avanzarLecturaResena(tabIdPanel, mensaje.payload?.resena || null);
        return;
      }
    }
    return;
  }

  if (!TIPOS_RELEVADOS.has(mensaje.tipo) || !mensaje.payload) return;
  chrome.tabs.query({}, (pestanas) => {
    for (const pestana of pestanas) {
      if (pestana.id == null || pestana.id === remitente.tab?.id) continue; // nunca de vuelta a la misma pestaña que lo mandó
      chrome.tabs.sendMessage(pestana.id, mensaje, () => {
        // "Could not establish connection" es el caso normal (pestaña
        // sin marcador-zilonix.js, es decir casi todas) — nunca un
        // error real que haga falta mostrar en ningún lado.
        void chrome.runtime.lastError;
      });
    }
  });
});
