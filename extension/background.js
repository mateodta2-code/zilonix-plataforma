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

// Issue #251 — "zilonix:dato-pagina-seguimiento" suma al mismo relevo
// genérico: Seguimiento no puede leer inventario/vendidos/publicaciones
// de un recurso AJENO por la API de Mercado Libre (403/ausente,
// confirmado en #250) — content.js lo manda cuando la persona abre la
// ficha de un competidor o la tienda que sigue, y solo la pestaña del
// panel de Seguimiento (con marcador-zilonix.js, y con el componente
// que escucha "dato-pagina-seguimiento" montado) hace algo con esto.
const TIPOS_RELEVADOS = new Set(["zilonix:vendidos", "zilonix:listado", "zilonix:dato-pagina-seguimiento"]);

// Issue #251 (revisión de Pablo, punto 4) — "que la lectura no dependa
// de tener abierta la pestaña de Seguimiento". Decisión de Mateo:
// SOLO cola + vaciado oportunista, nunca abrir una pestaña por su
// cuenta (seguiría siendo cierto que esta extensión "nunca navega sin
// un clic real" — abrir una pestaña nueva en automático para vaciar la
// cola habría roto esa garantía, documentada en LEEME.md, y hubiera
// necesitado un permiso nuevo en manifest.json solo para eso).
// chrome.storage.session (permiso "storage", nuevo en esta tarea — el
// único que tiene esta extensión) persiste mientras Chrome esté
// abierto, sin sobrevivir un reinicio del navegador: correcto para
// este dato (una lectura de página vieja ya no vale mucho) y evita
// guardar nada permanente sin que la persona lo sepa.
// Tope de seguridad — si de verdad nadie abre Seguimiento en mucho
// tiempo, la cola no crece sin límite; se descarta lo más viejo primero.
const TOPE_COLA_SEGUIMIENTO = 200;

// Issue #251, punto 9 (corrección de Pablo) — bug real: abrir varios
// `window.open()` en bucle desde la página (BotonActualizarTodo.tsx)
// lo bloquea el popup-blocker de Chrome después del primero o
// segundo, aunque venga de un clic real. `chrome.tabs.create` no es
// un popup — no lo bloquea — así que el botón manda los links por
// postMessage/marcador-zilonix.js y background.js (acá, privilegiado)
// es quien de verdad los abre. Mismo tope (5+5=10 competidores) y
// mismo allowlist de dominio QUE TAMBIÉN se revisan acá, nunca solo en
// la página: background.js es quien tiene el permiso real de abrir
// pestañas, así que es la última línea real de defensa.
const TOPE_SEGUIMIENTOS_ABRIR = 10;
const PATRON_DOMINIO_SEGUIMIENTO_PERMITIDO =
  /^https:\/\/([a-z0-9-]+\.)*mercado(libre\.(com\.co|com\.ar|com\.mx|cl|com\.uy|com\.pe)|livre\.com\.br)\//i;

function encolarDatoPaginaSeguimiento(payload) {
  chrome.storage.session.get({ colaSeguimiento: [] }, (datos) => {
    const cola = Array.isArray(datos.colaSeguimiento) ? datos.colaSeguimiento : [];
    cola.push(payload);
    while (cola.length > TOPE_COLA_SEGUIMIENTO) cola.shift();
    chrome.storage.session.set({ colaSeguimiento: cola });
  });
}

// Issue #251 — la página de Seguimiento (EscuchaExtension.tsx) pide
// esto una vez al montar, vía marcador-zilonix.js (dirección PÁGINA ->
// EXTENSIÓN, mismo criterio que "iniciar-escaneo"). Reenvía toda la
// cola encolada y la vacía — "oportunista": si NINGUNA pestaña la
// recibe de verdad, se queda intacta para el próximo intento, nunca se
// pierde por las dudas.
//
// Corrección de Pablo — dos cambios reales sobre el diseño anterior:
// (1) un solo mensaje con TODA la cola (`zilonix:cola-seguimiento`,
// `{payloads: [...]}`) por pestaña, en vez de un `chrome.tabs.sendMessage`
// por cada lectura encolada — EscuchaExtension.tsx la guarda con una
// sola Server Action y un solo router.refresh(), nunca uno por
// lectura. (2) la cola solo se vacía DESPUÉS de confirmar la entrega
// (con ack real de marcador-zilonix.js, que ahora responde {ok:true}):
// antes se vaciaba ANTES de intentar mandarla — si chrome.tabs.sendMessage
// fallaba (la pestaña de Seguimiento todavía no había montado su
// listener, o cualquier falla transitoria), esa cola completa se
// perdía para siempre.
function vaciarColaSeguimiento() {
  chrome.storage.session.get({ colaSeguimiento: [] }, (datos) => {
    const cola = Array.isArray(datos.colaSeguimiento) ? datos.colaSeguimiento : [];
    if (!cola.length) return;
    chrome.tabs.query({}, (pestanas) => {
      if (pestanas.length === 0) return; // nada que intentar — la cola queda intacta para el próximo "pedir-cola-seguimiento"
      let entregada = false;
      let pendientes = pestanas.length;
      const terminar = () => {
        pendientes -= 1;
        if (pendientes > 0) return;
        if (entregada) chrome.storage.session.set({ colaSeguimiento: [] });
      };
      for (const pestana of pestanas) {
        if (pestana.id == null) {
          terminar();
          continue;
        }
        chrome.tabs.sendMessage(pestana.id, { tipo: "zilonix:cola-seguimiento", payload: { payloads: cola } }, (respuesta) => {
          const error = chrome.runtime.lastError; // pestaña sin marcador-zilonix.js — nunca un error real
          void error;
          if (!error && respuesta && respuesta.ok) entregada = true;
          terminar();
        });
      }
    });
  });
}

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
// (PanelInvestigacion.tsx) para no quedarse mostrando "Escaneando..."
// para siempre.
const TOPE_TERMINOS_ESCANEO = 5; // issue #225 — término + hasta 4 variantes (IA + respaldo de reglas) = 5 queries, nunca más
const TOPE_PRODUCTOS_POR_VARIANTE = 30; // issue #229 — "maximizar volumen" subió esto de 20 a 30; el tope real vive en content.js (TOPE_PRODUCTOS_ENVIO_LISTADO), este es solo documentación
// Issue #227 — 15s fijos, pedido explícito de Sharel; confirmado
// además por Cowork en zilonix-os-web (chrome-extension-busqueda/
// scraper-listado.js, esperarTarjetas) como el tiempo real que ML
// necesita para pintar resultados cuando tarda (antes 8s, se quedaba
// corto) — mismo valor que TIEMPO_MAX_POR_TERMINO_MS (plataformas
// no-ML, más abajo) y TIEMPO_MAX_RESENA_MS (reseñas) — las 3 unificadas
// a 15000 por este issue, nunca más un número distinto por mecanismo.
const TIMEOUT_POR_VARIANTE_MS = 15000; // si una pestaña nunca contesta (bloqueo, captcha, red lenta), no se cuelga para siempre
void TOPE_PRODUCTOS_POR_VARIANTE;

// Un escaneo activo por pestaña del PANEL que lo pidió (nunca por
// pestaña de listado) — admite, en teoría, más de una pestaña de
// Investigación escaneando a la vez sin pisarse.
const escaneosActivos = new Map(); // tabIdPanel -> { terminos, indice, resultados, tabIdActual, timeoutId }

// Issue #227 — selector de país ML. SOLO Colombia (CO) está confirmado
// en vivo contra producción, en esta misma tarea (listado.mercadolibre.com.co) —
// los otros 5 dominios son del conocimiento público real de Mercado
// Libre (sus propios dominios regionales, no un detalle interno de
// scraping) pero construidos por sustitución del mismo patrón
// "listado.<dominio>/<término>", NUNCA probados en vivo todavía —
// pendiente de confirmar en el smoke de staging para AR/BR/MX/CL/UY/PE.
// Brasil es "mercadolivre" (marca en portugués), nunca "mercadolibre" —
// y Chile es "mercadolibre.cl" (sin "com." en el medio), los dos
// confirmados como dominios reales públicos de Mercado Libre.
// Issue #235 — bug real de Brasil, confirmado con evidencia real (no
// adivinado): listado.mercadolibre.com.co SÍ se puede confirmar en
// vivo desde este sandbox (bloqueado) pero la Wayback Machine de
// archive.org sí deja ver una captura real reciente de CADA sitio sin
// disparar el bloqueo de Mercado Libre — se usó esa vía para
// confirmar el subdominio real de cada país antes de tocar nada acá.
// `listado.mercadolibre.com.ar/zapatillas` tiene una captura real
// (confirma que el resto de países hispanohablantes SÍ usan
// "listado") — pero `listado.mercadolivre.com.br/...` NUNCA tuvo
// ninguna captura, mientras que `lista.mercadolivre.com.br/tenis` SÍ
// tiene una real, con tarjetas `li.ui-search-layout__item` reales e
// ids `MLB...` reales adentro. Brasil usa "lista" (portugués),
// nunca "listado" (español) — consistente con que el dominio en sí ya
// es "mercadolivre", no "mercadolibre". Hasta esta tarea, `urlListadoMl`
// armaba SIEMPRE `listado.${dominio}` para los 7 países por igual —
// para Brasil eso arma una URL que no es una página de listado real,
// así que nunca podía haber bloque ahí, sin importar qué tan bien
// funcionaran clasificarLinkListadoMl/tipoDePagina (#233).
const DOMINIOS_ML_PAIS = {
  CO: { dominio: "mercadolibre.com.co", nombre: "Mercado Libre Colombia", subdominioListado: "listado" },
  AR: { dominio: "mercadolibre.com.ar", nombre: "Mercado Libre Argentina", subdominioListado: "listado" },
  BR: { dominio: "mercadolivre.com.br", nombre: "Mercado Libre Brasil", subdominioListado: "lista" },
  MX: { dominio: "mercadolibre.com.mx", nombre: "Mercado Libre México", subdominioListado: "listado" },
  CL: { dominio: "mercadolibre.cl", nombre: "Mercado Libre Chile", subdominioListado: "listado" },
  UY: { dominio: "mercadolibre.com.uy", nombre: "Mercado Libre Uruguay", subdominioListado: "listado" },
  PE: { dominio: "mercadolibre.com.pe", nombre: "Mercado Libre Perú", subdominioListado: "listado" },
};

function urlListadoMl(termino, pais) {
  // Formato real confirmado contra producción para Colombia: palabras
  // separadas por guión, nunca espacios codificados. El marcador
  // "_zilonix_escaneo=1" (propio, nunca de Mercado Libre) es lo que
  // content.js usa para saber que esta pestaña puntual la abrió el
  // escaneo automático — nunca una persona a mano.
  const config = DOMINIOS_ML_PAIS[pais] || DOMINIOS_ML_PAIS.CO;
  const limpio = termino.trim().toLowerCase().replace(/\s+/g, "-");
  return `https://${config.subdominioListado}.${config.dominio}/${encodeURIComponent(limpio)}?_zilonix_escaneo=1`;
}

function iniciarEscaneo(tabIdPanel, terminosCrudos, pais) {
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

  // Issue #227 — selector de país ML (ver DOMINIOS_ML_PAIS arriba).
  const paisValido = typeof pais === "string" && DOMINIOS_ML_PAIS[pais] ? pais : "CO";
  escaneosActivos.set(tabIdPanel, { terminos, pais: paisValido, indice: 0, resultados: [], tabIdActual: null, timeoutId: null });
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
  chrome.tabs.create({ url: urlListadoMl(termino, estado.pais), active: true }, (tab) => {
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
  const nombrePais = (DOMINIOS_ML_PAIS[estado.pais] || DOMINIOS_ML_PAIS.CO).nombre;
  // Issue #221 — mismo tipo "zilonix:listado" que ya entiende el
  // panel (issue #213, "Importar listado") — con `origen:
  // "escaneo-analizar"` para que PanelDemanda.tsx lo fusione directo,
  // sin pedir otra vez "Importar/Fusionar/Reemplazar" (ese paso extra
  // tiene sentido para un listado manual que apareció de la nada;
  // acá la persona YA autorizó todo con el clic de Analizar).
  chrome.tabs.sendMessage(
    tabIdPanel,
    { tipo: "zilonix:listado", payload: { plataforma: nombrePais, url: "", productos, origen: "escaneo-analizar" } },
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
//
// Issue #227 — 15s fijos y documentados (antes 14000, pedido explícito
// de Sharel tras el smoke de CALZADO: "ajustar lo que hoy hace lento/
// inestable a 15s fijos") — mismo número que usa esperarTarjetas() en
// el scraper de listado real de ML (zilonix-os-web,
// chrome-extension-busqueda/scraper-listado.js), confirmado en vivo
// como el tiempo real que necesita Mercado Libre para pintar
// resultados cuando tarda (antes 8s, se quedaba corto).
const TIEMPO_MAX_RESENA_MS = 15000;
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
  chrome.tabs.update(estado.tabId, { url: conMarcadorResena(item.link) }, () => {
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

// Issue #225 (parte B) — "parity Zilonix OS" para las 5 plataformas
// no-ML: mismas URLs de búsqueda confirmadas en producción en
// zilonix-os-web (chrome-extension-busqueda/background.js), pero con
// UN orquestador genérico (nunca 5 copias casi idénticas, que es lo
// que tiene ese código real — "copiá el espíritu, no los bugs/olores")
// y reutilizando UNA sola pestaña por plataforma (chrome.tabs.update,
// nunca una pestaña nueva por término — mejora real sobre OS, que
// creaba una pestaña por término y la cerraba).
//
// 23000 era el valor REAL que Cowork afinó para estas 5 plataformas en
// zilonix-os-web — nunca inventado. El bug real de OS que esto evita:
// su panel tenía un timeout fijo de 90s sin importar cuántos términos
// hubiera — con 5 términos × 23s = 115s, el panel se rendía ANTES de
// que la extensión pudiera terminar en serio. Acá el timeout del panel
// se calcula dinámico (ver PanelDemanda.tsx, calcularTimeoutEscaneoMs:
// n × 25000 + 10000), nunca un número fijo que pueda quedar corto.
//
// Issue #227 — bajado a 15000 (pedido explícito de Sharel: "15s por
// búsqueda de variante", fijos y documentados, para las 6 plataformas
// por igual) — mismo valor que ya usa TIMEOUT_POR_VARIANTE_MS para
// Mercado Libre, y el mismo que confirmó Cowork como necesario en
// zilonix-os-web (chrome-extension-busqueda/scraper-listado.js,
// esperarTarjetas) para que ML termine de pintar resultados reales.
const TIEMPO_MAX_POR_TERMINO_MS = 15000;
// Alibaba puede interceptar con un CAPTCHA (confirmado en vivo por
// Cowork) — nunca se evade ni se resuelve solo; se detecta, se avisa,
// y se le da a la persona mucho más tiempo (este timeout, no el de
// arriba) para resolverlo A MANO en la misma pestaña, que queda
// visible para eso (ver PLATAFORMAS.alibaba.previewPorDefecto).
const TIEMPO_MAX_CAPTCHA_MS = 120000;

function slugAliExpress(termino) {
  // Mismo slug real confirmado en zilonix-os-web — AliExpress usa
  // "/w/wholesale-<palabras-con-guiones>.html", nunca query string.
  return termino
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Issue #229 — hotfix de smoke real: "clic Amazon/Temu/AliExpress/
// Shein/Alibaba agrega bloque real al tablero — hoy no trae nada".
// Causa real confirmada leyendo content.js: `enviarListadoAZilonix`
// solo manda el resultado SOLA (sin esperar un clic, issue #221) si
// `esPaginaDeEscaneoAutomatico()` encuentra `_zilonix_escaneo=1` en la
// URL — marcador que `urlListadoMl` (arriba) sí le pone a Mercado
// Libre, pero que las 5 URLs de abajo NUNCA tuvieron. Sin ese
// marcador, cada término simplemente agota TIEMPO_MAX_POR_TERMINO_MS
// (15s) sin mandar nada — por eso el tablero quedaba siempre vacío
// para estas 5 plataformas, no por ningún bloqueo del sitio ni
// selector roto. `conMarcadorEscaneo` agrega el mismo marcador propio
// (invisible para cada sitio, un query param más) usando `URL` real
// en vez de concatenar `?`/`&` a mano, para no romper ninguna de las
// 2 formas de URL de abajo (con query string ya armada, o sin
// ninguna).
function conMarcadorEscaneo(urlCruda) {
  try {
    const url = new URL(urlCruda);
    url.searchParams.set("_zilonix_escaneo", "1");
    return url.href;
  } catch {
    return urlCruda; // nunca debería pasar — las 5 URLs de abajo siempre son absolutas y válidas
  }
}

// Issue #251 (revisión de Pablo, punto 4) — mismo criterio que
// conMarcadorEscaneo (arriba): esta pestaña de "Top 8 reseñas" la abrió
// la propia extensión, nunca la persona con un clic sobre ESTA página
// en particular — content.js la usa para no mandar inventario/vendidos
// de Seguimiento desde acá (ver esPaginaDeLecturaResenas, en
// content.js). No afecta "Completar vendidos"/reseñas en sí (eso sigue
// mandándose igual, el marcador solo gatea Seguimiento).
function conMarcadorResena(urlCruda) {
  try {
    const url = new URL(urlCruda);
    url.searchParams.set("_zilonix_resena", "1");
    return url.href;
  } catch {
    return urlCruda;
  }
}

// Adaptadores por plataforma — SOLO lo que de verdad cambia entre una
// y otra (la URL de búsqueda real, confirmada en producción) y si por
// default conviene que la persona VEA la pestaña (solo Alibaba, por
// el captcha). El resto del mecanismo (una pestaña reutilizada,
// mismo timeout, mismo relevo con content.js) es idéntico para las 5.
const PLATAFORMAS = {
  amazon: {
    url: (t) => conMarcadorEscaneo(`https://www.amazon.com/s?k=${encodeURIComponent(t.trim())}&language=es_US`),
  },
  temu: {
    url: (t) => conMarcadorEscaneo(`https://www.temu.com/search_result.html?search_key=${encodeURIComponent(t.trim())}`),
  },
  aliexpress: {
    url: (t) => conMarcadorEscaneo(`https://www.aliexpress.com/w/wholesale-${encodeURIComponent(slugAliExpress(t.trim()))}.html`),
  },
  shein: {
    url: (t) => conMarcadorEscaneo(`https://www.shein.com.co/pdsearch/${encodeURIComponent(t.trim())}/`),
  },
  alibaba: {
    url: (t) => conMarcadorEscaneo(`https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(t.trim())}`),
    previewPorDefecto: true,
  },
};

const TOPE_TERMINOS_PLATAFORMA = 5; // término + hasta 4 variantes de IA (ver lib/ml/variantesIA.ts)

// Un escaneo activo por pestaña del PANEL que lo pidió — mismo
// criterio que escaneosActivos/resenasActivas arriba.
const escaneosPlataforma = new Map(); // tabIdPanel -> { plataforma, tabId, terminos, indice, vistos, timeoutId }

function iniciarEscaneoPlataforma(tabIdPanel, plataforma, terminosCrudos, previewPedido) {
  const config = PLATAFORMAS[plataforma];
  if (!config) return;

  const anterior = escaneosPlataforma.get(tabIdPanel);
  if (anterior) {
    clearTimeout(anterior.timeoutId);
    if (anterior.tabId != null) chrome.tabs.remove(anterior.tabId, () => void chrome.runtime.lastError);
  }

  const terminos = (terminosCrudos || []).filter((t) => typeof t === "string" && t.trim()).slice(0, TOPE_TERMINOS_PLATAFORMA);
  if (!terminos.length) return;

  // "Preview opcional (default on solo Alibaba)" — issue #225: la
  // pestaña queda VISIBLE para que la persona pueda ver/resolver un
  // captcha de inmediato, en vez de que todo pase a ciegas en una
  // pestaña de fondo.
  const activa = typeof previewPedido === "boolean" ? previewPedido : Boolean(config.previewPorDefecto);

  chrome.tabs.create({ url: "about:blank", active: activa }, (tab) => {
    if (chrome.runtime.lastError || !tab?.id) return;
    escaneosPlataforma.set(tabIdPanel, { plataforma, tabId: tab.id, terminos, indice: 0, vistos: new Map(), timeoutId: null });
    abrirSiguienteTerminoPlataforma(tabIdPanel);
  });
}

function abrirSiguienteTerminoPlataforma(tabIdPanel) {
  const estado = escaneosPlataforma.get(tabIdPanel);
  if (!estado) return;

  if (estado.indice >= estado.terminos.length) {
    finalizarEscaneoPlataforma(tabIdPanel);
    return;
  }

  const config = PLATAFORMAS[estado.plataforma];
  const termino = estado.terminos[estado.indice];
  chrome.tabs.update(estado.tabId, { url: config.url(termino) }, () => {
    if (chrome.runtime.lastError) {
      estado.indice++;
      abrirSiguienteTerminoPlataforma(tabIdPanel);
      return;
    }
    estado.timeoutId = setTimeout(() => avanzarEscaneoPlataforma(tabIdPanel, [], false), TIEMPO_MAX_POR_TERMINO_MS);
  });
}

function avanzarEscaneoPlataforma(tabIdPanel, productos, captcha) {
  const estado = escaneosPlataforma.get(tabIdPanel);
  if (!estado) return;
  clearTimeout(estado.timeoutId);

  if (captcha) {
    // Issue #225 — NUNCA se evade ni se resuelve solo: se avisa al
    // panel y se le da a la persona mucho más tiempo (TIEMPO_MAX_CAPTCHA_MS)
    // para resolverlo a mano en la misma pestaña (que ya está visible,
    // ver previewPorDefecto). content.js sigue reintentando leer esa
    // MISMA página sola (reescanearConRetardo) — en cuanto el captcha
    // se resuelva y aparezcan resultados reales, llega un mensaje
    // nuevo sin captcha y esto avanza normal, nunca hace falta que la
    // persona "reintente" nada a mano en el panel.
    chrome.tabs.sendMessage(tabIdPanel, { tipo: "zilonix:escaneo-plataforma-captcha", payload: { plataforma: estado.plataforma } }, () => void chrome.runtime.lastError);
    estado.timeoutId = setTimeout(() => avanzarEscaneoPlataforma(tabIdPanel, [], false), TIEMPO_MAX_CAPTCHA_MS);
    return;
  }

  // Dedup por link (content.js ya manda la forma genérica
  // {titulo, precio, vendidos, link} para los 6 sitios, sin un id
  // propio de cada plataforma) — mismo campo que usa el panel
  // (fusionarProductosImportados), así que un duplicado entre dos
  // variantes nunca infla el total, ni acá ni al fusionar después.
  for (const p of productos) {
    const clave = (p && p.link) || (p && p.titulo);
    if (clave && !estado.vistos.has(clave)) estado.vistos.set(clave, p);
  }
  estado.indice++;
  abrirSiguienteTerminoPlataforma(tabIdPanel);
}

function finalizarEscaneoPlataforma(tabIdPanel) {
  const estado = escaneosPlataforma.get(tabIdPanel);
  escaneosPlataforma.delete(tabIdPanel);
  if (!estado) return;

  chrome.tabs.remove(estado.tabId, () => void chrome.runtime.lastError);
  chrome.tabs.sendMessage(
    tabIdPanel,
    { tipo: "zilonix:escaneo-plataforma-resultado", payload: { plataforma: estado.plataforma, productos: [...estado.vistos.values()] } },
    () => void chrome.runtime.lastError
  );
  chrome.tabs.update(tabIdPanel, { active: true }, () => void chrome.runtime.lastError);
}

chrome.runtime.onMessage.addListener((mensaje, remitente) => {
  if (!mensaje) return;

  if (mensaje.tipo === "zilonix:iniciar-escaneo") {
    if (!remitente.tab?.id) return;
    const terminos = Array.isArray(mensaje.payload?.terminos) ? mensaje.payload.terminos : [];
    iniciarEscaneo(remitente.tab.id, terminos, mensaje.payload?.pais);
    return;
  }

  if (mensaje.tipo === "zilonix:escaneo-resultado") {
    // Viene de una pestaña de listado que ESTE Service Worker abrió —
    // se busca a qué escaneo (de qué pestaña del panel) pertenece por
    // tabIdActual, nunca por remitente.tab.id solo (content.js ni
    // sabe qué pestaña de panel lo originó). Mismo mensaje genérico
    // para Mercado Libre (escaneosActivos, #221) y para las 5
    // plataformas no-ML (escaneosPlataforma, #225) — content.js es el
    // mismo content script para los 6 sitios, nunca duplicado.
    for (const [tabIdPanel, estado] of escaneosActivos) {
      if (estado.tabIdActual === remitente.tab?.id) {
        cerrarVarianteYSeguir(tabIdPanel, remitente.tab.id, mensaje.payload);
        return;
      }
    }
    for (const [tabIdPanel, estado] of escaneosPlataforma) {
      if (estado.tabId === remitente.tab?.id) {
        avanzarEscaneoPlataforma(tabIdPanel, mensaje.payload?.productos || [], Boolean(mensaje.payload?.captcha));
        return;
      }
    }
    return; // ninguna variante activa esperaba esto (ej. llegó tarde, después del timeout) — nunca rompe nada
  }

  if (mensaje.tipo === "zilonix:iniciar-escaneo-plataforma") {
    if (!remitente.tab?.id) return;
    const payload = mensaje.payload || {};
    iniciarEscaneoPlataforma(remitente.tab.id, payload.plataforma, payload.terminos, payload.preview);
    return;
  }

  if (mensaje.tipo === "zilonix:iniciar-resenas") {
    if (!remitente.tab?.id) return;
    iniciarLecturaResenas(remitente.tab.id, mensaje.payload?.items);
    return;
  }

  // Issue #251 (revisión de Pablo, punto 4) — EscuchaExtension.tsx lo
  // manda una vez al montar /panel/investigacion/seguimiento, para
  // vaciar lo que haya quedado encolado de visitas a Mercado Libre
  // mientras esa pestaña estaba cerrada.
  if (mensaje.tipo === "zilonix:pedir-cola-seguimiento") {
    vaciarColaSeguimiento();
    return;
  }

  // Issue #251, punto 9 (corrección de Pablo) — "Actualizar todo":
  // BotonActualizarTodo.tsx manda esto desde su propio onClick (un
  // clic real, nunca solo) en vez de hacer window.open en bucle (lo
  // bloquea el popup-blocker). Nunca abre más de TOPE_SEGUIMIENTOS_ABRIR
  // ni nada que no sea un dominio real de Mercado Libre/Mercado Livre,
  // sin importar qué mande la página — background.js es el único
  // lugar con el permiso real de abrir pestañas.
  if (mensaje.tipo === "zilonix:abrir-seguimientos") {
    const links = Array.isArray(mensaje.payload && mensaje.payload.links) ? mensaje.payload.links : [];
    const validos = links.filter((link) => typeof link === "string" && PATRON_DOMINIO_SEGUIMIENTO_PERMITIDO.test(link)).slice(0, TOPE_SEGUIMIENTOS_ABRIR);
    for (const url of validos) {
      // active: false — las pestañas se abren en segundo plano, nunca
      // le quitan el foco a la persona del clic que las disparó; la
      // extensión las lee igual al cargar (content.js/reescanear()),
      // estén o no en foco.
      chrome.tabs.create({ url, active: false });
    }
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
    // Issue #251 (revisión de Pablo, punto 4) — si NINGUNA pestaña
    // abierta ahora mismo es la de Seguimiento, se encola para
    // cuando se abra. Si YA hay una (p.url visible sin permiso nuevo:
    // esta extensión ya tiene un content script que matchea esa URL,
    // ver manifest.json), nunca se encola — el broadcast de abajo
    // (el mismo de siempre, sin confirmación de guardado) es quien la
    // entrega, y encolarla también replayaría después un dato viejo
    // encima de uno más fresco que ese broadcast ya guardó.
    if (mensaje.tipo === "zilonix:dato-pagina-seguimiento") {
      const hayPestanaSeguimientoAbierta = pestanas.some(
        (p) => typeof p.url === "string" && p.url.includes("/panel/investigacion/seguimiento")
      );
      if (!hayPestanaSeguimientoAbierta) encolarDatoPaginaSeguimiento(mensaje.payload);
    }
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
