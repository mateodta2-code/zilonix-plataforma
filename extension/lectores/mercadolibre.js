// Issue #174 — lector de Mercado Libre Colombia. Los selectores de
// abajo son los reales de las plantillas "ui-pdp-*" (producto) y
// "ui-search-*" (listado/búsqueda) al momento de escribir esto —
// Mercado Libre las cambia de tanto en tanto, por eso cada campo
// prueba VARIAS alternativas (la más nueva primero) antes de rendirse
// y mostrar "no disponible". Si algún día ninguna funciona, se
// agregan más strings a la lista — nunca hace falta tocar content.js.
(function () {
  "use strict";
  // Issue #174, mejora de "vendidos exacto" — las funciones de acá
  // abajo (leerDatosIncrustados/calcularVentasPromedioMes) son texto
  // puro, sin DOM, para poder probarlas con un HTML de ejemplo sin
  // navegador (ver extension/lectores/mercadolibre.test.ts). En Node
  // (vitest) no existe `window` — se usa utilidades.js directo con
  // require(); en el navegador (content script real) `window` sí
  // existe y nunca se llega a pedir `require`.
  const U = typeof window !== "undefined" ? window.ZilonixUtilidades : require("../utilidades.js");

  function tipoDePagina(url) {
    if (/\/(p\/)?MCO-?\d+/i.test(url) || /articulo\.mercadolibre/i.test(url)) return "producto";
    if (/listado\.mercadolibre|\/search|[?&]q=/i.test(url)) return "listado";
    return null;
  }

  // Issue #174, mejora de "vendidos exacto" — Mercado Libre ya NO
  // muestra el número exacto de ventas en la interfaz (solo la
  // etiqueta redondeada "+500 vendidos"), pero el número real sigue
  // viajando en el JSON que la propia página incrusta para pintarse
  // ella misma (server-side rendering) — hoy bajo la variable global
  // `window.__NORDIC_RENDERING_CTX__`. Se busca ahí primero (balance
  // real de llaves, no un regex "greedy" que podría cortar mal un
  // JSON con objetos anidados); si no está esa variable, o cambió de
  // nombre, o el JSON no trae esas 3 claves, se cae al respaldo de
  // texto plano que pidió la tarea: buscar "sold_quantity" (y
  // item_id/date_created) directo en el HTML, sin parsear nada.
  //
  // NUNCA pide nada por red: todo esto lee el HTML que el navegador
  // YA cargó (el `outerHTML` que pasa leerProducto(), más abajo) —
  // cero peticiones extra, cero pestañas nuevas.
  const NOMBRE_VARIABLE_INCRUSTADA = "__NORDIC_RENDERING_CTX__";

  // Extrae el primer objeto { ... } balanceado después de
  // "nombreVariable = " dentro de `html` — a mano, no con un regex,
  // porque un JSON real de Mercado Libre tiene objetos/arreglos
  // anidados y strings con "{"/"}" adentro (ej. una descripción); un
  // regex "no greedy" cortaría en la primera "}" que encuentre, casi
  // siempre a mitad del objeto real.
  function extraerJsonTrasVariable(html, nombreVariable) {
    const indiceVariable = html.indexOf(nombreVariable);
    if (indiceVariable === -1) return null;
    const indiceIgual = html.indexOf("=", indiceVariable);
    if (indiceIgual === -1) return null;

    let i = indiceIgual + 1;
    while (i < html.length && /\s/.test(html[i])) i++;
    if (html[i] !== "{") return null;

    const inicio = i;
    let profundidad = 0;
    let dentroDeString = false;
    let comillaActual = "";
    let escapando = false;
    for (; i < html.length; i++) {
      const c = html[i];
      if (dentroDeString) {
        if (escapando) escapando = false;
        else if (c === "\\") escapando = true;
        else if (c === comillaActual) dentroDeString = false;
        continue;
      }
      if (c === '"' || c === "'") {
        dentroDeString = true;
        comillaActual = c;
        continue;
      }
      if (c === "{") profundidad++;
      else if (c === "}") {
        profundidad--;
        if (profundidad === 0) return html.slice(inicio, i + 1);
      }
    }
    return null; // nunca se cerró — HTML cortado a mitad de carga, u otra forma inesperada
  }

  // Busca `clave` en cualquier nivel de profundidad de `obj` (objetos
  // y arreglos) — el JSON real de ML anida sold_quantity/item_id/
  // date_created bajo una ruta que puede cambiar de versión a
  // versión; buscar por clave en profundidad es más resistente a eso
  // que adivinar una ruta fija (ej. "components.price.item.id").
  function buscarClaveProfundo(obj, clave, visitados) {
    visitados = visitados || new Set();
    if (!obj || typeof obj !== "object" || visitados.has(obj)) return undefined;
    visitados.add(obj);
    if (!Array.isArray(obj) && Object.prototype.hasOwnProperty.call(obj, clave)) return obj[clave];
    const valores = Array.isArray(obj) ? obj : Object.values(obj);
    for (const valor of valores) {
      const resultado = buscarClaveProfundo(valor, clave, visitados);
      if (resultado !== undefined) return resultado;
    }
    return undefined;
  }

  function leerDatosIncrustados(html) {
    const vacio = { soldQuantity: null, itemId: null, dateCreated: null };
    if (typeof html !== "string" || !html) return vacio;

    let soldQuantity = null;
    let itemId = null;
    let dateCreated = null;

    const jsonCrudo = extraerJsonTrasVariable(html, NOMBRE_VARIABLE_INCRUSTADA);
    if (jsonCrudo) {
      try {
        const datos = JSON.parse(jsonCrudo);
        const valorSold = buscarClaveProfundo(datos, "sold_quantity");
        const valorItem = buscarClaveProfundo(datos, "item_id") ?? buscarClaveProfundo(datos, "id");
        const valorFecha = buscarClaveProfundo(datos, "date_created");
        if (typeof valorSold === "number" && Number.isFinite(valorSold)) soldQuantity = valorSold;
        if (typeof valorItem === "string") itemId = valorItem;
        if (typeof valorFecha === "string") dateCreated = valorFecha;
      } catch {
        // JSON cortado, o cambió de forma — se cae al respaldo de texto de abajo, nunca revienta.
      }
    }

    // Respaldo pedido explícito por la tarea: directo en el texto del
    // HTML, sin parsear nada — cubre tanto que la variable haya
    // cambiado de nombre como que el JSON de arriba no trajera alguna
    // de las 3 claves.
    if (soldQuantity === null) {
      const m = html.match(/"sold_quantity"\s*:\s*(\d+)/);
      if (m) soldQuantity = Number(m[1]);
    }
    if (itemId === null) {
      const m = html.match(/"item_id"\s*:\s*"([A-Z]{2,4}\d+)"/i) || html.match(/"id"\s*:\s*"(MCO\d+)"/i);
      if (m) itemId = m[1];
    }
    if (dateCreated === null) {
      const m = html.match(/"date_created"\s*:\s*"([^"]+)"/);
      if (m) dateCreated = m[1];
    }

    return { soldQuantity, itemId, dateCreated };
  }

  // "Ventas promedio al mes" = vendidos × 30 ÷ días desde la
  // publicación — siempre un ESTIMADO (lo pide la tarea explícito),
  // nunca una cifra que Mercado Libre confirme directamente. `vendidos`
  // puede ser el exacto (sold_quantity) o el aproximado de "+N
  // vendidos" — lo único obligatorio es `dateCreated`, que solo sale
  // del JSON incrustado (nunca de la interfaz visible).
  function calcularVentasPromedioMes(vendidos, dateCreated, ahoraMs) {
    if (typeof vendidos !== "number" || !Number.isFinite(vendidos) || !dateCreated) return null;
    const creadoMs = new Date(dateCreated).getTime();
    if (!Number.isFinite(creadoMs)) return null;
    const ahora = typeof ahoraMs === "number" ? ahoraMs : Date.now();
    // Mínimo 1 día — una publicación de hoy mismo no puede dividir por 0
    // ni dar un promedio mensual absurdamente alto por una fecha futura mal leída.
    const diasTranscurridos = Math.max(1, Math.round((ahora - creadoMs) / 86_400_000));
    return Math.round(((vendidos * 30) / diasTranscurridos) * 10) / 10;
  }

  function leerProducto(doc) {
    const bloqueEnvio = U.primerElemento([".ui-pdp-shipping", ".ui-pdp-container__col--shipping"], doc);
    const textoEnvio = bloqueEnvio ? bloqueEnvio.textContent || "" : "";
    const textoSubtitulo = U.textoDe([".ui-pdp-subtitle", "span.ui-pdp-subtitle"], doc) || "";

    // "Catálogo" en ML = la publicación trae varias ofertas de
    // distintos vendedores para el mismo producto — el marcador real
    // es el bloque "Mejor opción de compra"/"Otras opciones de compra".
    const tieneBuybox = Boolean(U.primerElemento([".ui-pdp-buybox__highlight", ".ui-pdp-seller__header"], doc));

    const vendidosAproximado = U.enteroDesdeTexto((textoSubtitulo.match(/[\d.,]+\s*vendid/i) || [])[0] || null);
    const htmlCompleto = doc && doc.documentElement ? doc.documentElement.outerHTML : "";
    const incrustado = leerDatosIncrustados(htmlCompleto);
    const vendidos = incrustado.soldQuantity !== null ? incrustado.soldQuantity : vendidosAproximado;
    // true = exacto (sold_quantity real, del JSON/HTML incrustado);
    // false = solo la etiqueta redondeada "+N vendidos"; null = nada.
    const vendidosExacto = incrustado.soldQuantity !== null ? true : vendidosAproximado !== null ? false : null;

    return {
      titulo: U.textoDe(["h1.ui-pdp-title", "h1[data-testid='product-title']"], doc),
      precio: U.numeroDesdeTexto(
        U.textoDe([".ui-pdp-price__second-line .andes-money-amount__fraction", ".ui-pdp-price .andes-money-amount__fraction"], doc)
      ),
      moneda: "COP",
      precioAnterior: U.numeroDesdeTexto(U.textoDe([".ui-pdp-price__original-value .andes-money-amount__fraction", "s .andes-money-amount__fraction"], doc)),
      descuentoPorcentaje: U.enteroDesdeTexto(
        U.textoDe([".ui-pdp-price__second-line .andes-money-amount__discount-tag", ".ui-pdp-price__discount"], doc)
      ),
      vendidos,
      vendidosExacto,
      ventasPromedioMes: calcularVentasPromedioMes(vendidos, incrustado.dateCreated),
      vendedor: U.textoDe([".ui-pdp-seller__header__title", ".ui-pdp-seller__link-trigger-button", "a.ui-pdp-seller__link-trigger-button"], doc),
      calificacion: U.calificacionDesdeTexto(U.textoDe([".ui-pdp-review__rating", ".ui-review-capability__rating__average"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe([".ui-pdp-review__amount", ".ui-review-capability__rating__amount"], doc)),
      esCatalogo: tieneBuybox,
      esFull: /\bfull\b/i.test(textoEnvio),
      envioGratis: /envío\s*gratis|envio\s*gratis/i.test(textoEnvio),
    };
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("li.ui-search-layout__item, div.ui-search-result, li.ui-search-layout_grid-item");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["h2.ui-search-item__title", ".ui-search-item__title", "h3.poly-component__title"], tarjeta);
      const precio = U.numeroDesdeTexto(
        U.textoDe([".ui-search-price__second-line .andes-money-amount__fraction", ".andes-money-amount__fraction"], tarjeta)
      );
      const textoTarjeta = tarjeta.textContent || "";
      const vendidos = U.enteroDesdeTexto((textoTarjeta.match(/[\d.,]+\s*vendid/i) || [])[0] || null);
      const link = U.atributoDe(["a.ui-search-link", "a.ui-search-item__group__element", "a.poly-component__title"], "href", tarjeta);
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos, link });
    });
    return { productos };
  }

  const api = { tipoDePagina, leerProducto, leerListado, leerDatosIncrustados, calcularVentasPromedioMes };

  // Igual que extension/seguridad.js: en el navegador real no existe
  // `module` — este bloque solo corre cuando vitest hace require()/
  // import() del archivo, sin navegador.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixLectorActivo = { sitio: "Mercado Libre Colombia", tipoDePagina, leerProducto, leerListado };
  }
})();
