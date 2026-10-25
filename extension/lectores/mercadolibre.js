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
  // Issue #174 — URL_APP para el botón "Seguir en Zilonix", ver
  // extension/config.js. Mismo patrón de acceso dual que U, arriba.
  const CONFIG = typeof window !== "undefined" ? window.ZilonixConfig : require("../config.js");

  function tipoDePagina(url) {
    if (/\/(p\/)?MCO-?\d+/i.test(url) || /articulo\.mercadolibre/i.test(url)) return "producto";
    // Página de UN vendedor/tienda (perfil público o tienda oficial) —
    // nunca confundir con /listado (que es una búsqueda, no un
    // perfil). Se prueba ANTES del check de /listado de abajo:
    // "confirmado en producción" (ver lib/seguimiento/link.ts) el link
    // real con _CustId_/?CustId= vive bajo el dominio
    // listado.mercadolibre.com.co — si el check de /listado fuera
    // primero, ESE link (una tienda real) se clasificaría mal como
    // "listado" antes de llegar nunca a este if.
    //
    // Issue #192, bug real: una tienda oficial real
    // (www.mercadolibre.com.co/tienda/colchones-relax?item_id=...) no
    // tenía ningún patrón que la reconociera — ninguno de los tres de
    // abajo matcheaba (no es /perfil/, no es el subdominio
    // tienda.mercadolibre.*, y no trae ?CustId=) — el panel ni
    // siquiera se dibujaba, silencio total. /tienda/ (el path real de
    // una tienda oficial) se suma como cuarto patrón.
    if (/\/perfil\/|tienda\.mercadolibre|\/tienda\/|[?&]CustId=/i.test(url)) return "tienda";
    if (/listado\.mercadolibre|\/search|[?&]q=/i.test(url)) return "listado";
    return null;
  }

  // Issue #174 — "Seguir en Zilonix": el panel de producto/tienda abre,
  // SOLO por clic real de la persona (nunca solo), una pestaña nueva
  // hacia Zilonix Seller con el id a agregar al seguimiento. El id
  // SIEMPRE se valida y se encodea antes de armar el link — nunca se
  // pega un id (de la URL o del HTML) directo a una URL.
  const PATRON_ID_ITEM = /^MCO\d+$/;
  const PATRON_ID_VENDEDOR = /^\d+$/;

  function construirLinkSeguirProducto(itemId) {
    if (typeof itemId !== "string" || !PATRON_ID_ITEM.test(itemId)) return null;
    return `${CONFIG.URL_APP}/panel/investigacion/seguimiento?agregar=${encodeURIComponent(itemId)}`;
  }

  function construirLinkSeguirTienda(sellerId) {
    if (typeof sellerId !== "string" || !PATRON_ID_VENDEDOR.test(sellerId)) return null;
    return `${CONFIG.URL_APP}/panel/investigacion/seguimiento?agregar_tienda=${encodeURIComponent(sellerId)}`;
  }

  // Issue #188 — "CustId=123456" en la URL (la forma clásica de
  // "visitar vendedor" de Mercado Libre) -> "123456". Viene directo
  // de la URL, nada que adivinar del HTML — por eso leerSellerIdDeTienda
  // (abajo) la prueba primero, antes que cualquier cosa del HTML.
  function extraerCustIdDeUrl(url) {
    if (typeof url !== "string") return null;
    const m = url.match(/[?&]CustId=(\d+)/i);
    return m ? m[1] : null;
  }

  // Issue #174, corrección real: `user_id` en el JSON incrustado de
  // una página de tienda suele ser el de la PERSONA con sesión
  // iniciada en el navegador (si hay una) — no el del vendedor de esa
  // tienda. Usarlo como respaldo podía mandar a "seguir" al usuario
  // que está mirando la página, no al vendedor. Se quita ese
  // respaldo: solo `seller_id` (siempre el vendedor real), y antes que
  // nada, si la URL trae `?CustId=<dígitos>` se usa ese — viene
  // directo de la URL, nada que adivinar del HTML.
  //
  // Issue #192 — a propósito NUNCA se lee `official_store_id` de la
  // URL (ej. `?official_store_id=53573` de una tienda oficial) como
  // id del vendedor: es el id de la TIENDA OFICIAL, un concepto
  // distinto de `seller_id` en el modelo de Mercado Libre — pueden
  // coincidir o no, y no hay una forma segura de confirmarlo sin
  // pedirle más datos a Mercado Libre (que esta extensión nunca hace,
  // solo lee lo que la página ya cargó). Mismo criterio que el
  // propio link.ts del panel (lib/seguimiento/link.ts,
  // interpretarEnlaceTienda): sin CustId y sin seller_id confirmado en
  // el HTML, es null — nunca se adivina.
  function leerSellerIdDeTienda(html, url) {
    const deLaUrl = extraerCustIdDeUrl(url);
    if (deLaUrl) return deLaUrl;
    if (typeof html !== "string" || !html) return null;
    const m = html.match(/"seller_id"\s*:\s*"?(\d+)"?/);
    return m ? m[1] : null;
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

  // Issue #174, corrección real: la página de un producto trae en el
  // mismo JSON los datos de OTROS productos (recomendados, "quienes
  // vieron esto también vieron"...) — buscar sold_quantity en
  // cualquier profundidad, sin más, podía devolver el de un producto
  // DISTINTO si el actual no traía el campo pero algún recomendado sí.
  // Todo lo de abajo amarra sold_quantity/date_created al producto que
  // el usuario está viendo de verdad, nunca al primero que aparezca.

  // "MCO-123456789" o "MCO123456789" (con o sin guión) -> "MCO123456789".
  function extraerIdDeUrl(url) {
    if (typeof url !== "string") return null;
    const m = url.match(/MCO-?(\d+)/i);
    return m ? `MCO${m[1]}` : null;
  }

  function normalizarId(valor) {
    if (typeof valor !== "string" && typeof valor !== "number") return null;
    return String(valor).toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  // Busca, en cualquier nivel de profundidad de `obj`, el objeto cuyo
  // `id`/`item_id` coincide con `itemIdActual` — y devuelve ESE
  // objeto completo (de donde el llamador saca sold_quantity/
  // date_created), nunca el primero que tenga sold_quantity sin
  // importar de qué producto sea.
  function buscarObjetoConId(obj, itemIdActual, visitados) {
    visitados = visitados || new Set();
    if (!obj || typeof obj !== "object" || visitados.has(obj)) return undefined;
    visitados.add(obj);
    if (!Array.isArray(obj)) {
      const idCandidato = normalizarId(obj.item_id ?? obj.id);
      if (idCandidato && idCandidato === itemIdActual) return obj;
    }
    const valores = Array.isArray(obj) ? obj : Object.values(obj);
    for (const valor of valores) {
      const resultado = buscarObjetoConId(valor, itemIdActual, visitados);
      if (resultado !== undefined) return resultado;
    }
    return undefined;
  }

  // Respaldo de texto plano (sin JSON.parse) — mismo criterio de
  // amarre: solo cuenta un "sold_quantity"/"date_created" si aparece
  // dentro de los ~500 caracteres alrededor de un "id"/"item_id" que
  // sea el producto actual. Un "sold_quantity" de otro producto más
  // lejos en el HTML nunca entra.
  const VENTANA_CARACTERES = 500;
  function buscarDatosCercaDelId(html, itemIdActual) {
    const vacio = { soldQuantity: null, dateCreated: null };
    if (!itemIdActual) return vacio;
    const patronId = new RegExp(`"(?:id|item_id)"\\s*:\\s*"${itemIdActual}"`, "gi");
    for (const coincidencia of html.matchAll(patronId)) {
      const indice = coincidencia.index ?? 0;
      const ventana = html.slice(Math.max(0, indice - VENTANA_CARACTERES), indice + VENTANA_CARACTERES);
      const coincidenciaSold = ventana.match(/"sold_quantity"\s*:\s*(\d+)/);
      if (!coincidenciaSold) continue; // esta aparición del id no tiene sold_quantity cerca — puede haber otra más abajo
      const coincidenciaFecha = ventana.match(/"date_created"\s*:\s*"([^"]+)"/);
      return { soldQuantity: Number(coincidenciaSold[1]), dateCreated: coincidenciaFecha ? coincidenciaFecha[1] : null };
    }
    return vacio;
  }

  // `itemIdActual` ya viene normalizado (extraerIdDeUrl) — sin él no
  // hay con qué confirmar que un sold_quantity es del producto
  // correcto, así que se devuelve todo en null (el llamador cae al
  // aproximado de "+N vendidos", marcado "(aproximado)").
  function leerDatosIncrustados(html, itemIdActual) {
    const vacio = { soldQuantity: null, itemId: null, dateCreated: null };
    if (typeof html !== "string" || !html || !itemIdActual) return vacio;

    let soldQuantity = null;
    let itemId = null;
    let dateCreated = null;

    const jsonCrudo = extraerJsonTrasVariable(html, NOMBRE_VARIABLE_INCRUSTADA);
    if (jsonCrudo) {
      try {
        const datos = JSON.parse(jsonCrudo);
        const objetoDelItem = buscarObjetoConId(datos, itemIdActual);
        if (objetoDelItem) {
          if (typeof objetoDelItem.sold_quantity === "number" && Number.isFinite(objetoDelItem.sold_quantity)) {
            soldQuantity = objetoDelItem.sold_quantity;
          }
          if (typeof objetoDelItem.date_created === "string") dateCreated = objetoDelItem.date_created;
          const valorId = objetoDelItem.item_id ?? objetoDelItem.id;
          if (typeof valorId === "string") itemId = valorId;
        }
      } catch {
        // JSON cortado, o cambió de forma — se cae al respaldo de texto de abajo, nunca revienta.
      }
    }

    // Respaldo de texto plano — mismo amarre al item actual, nunca el
    // "id":"MCO..." genérico de cualquier producto de la página.
    if (soldQuantity === null) {
      const resultado = buscarDatosCercaDelId(html, itemIdActual);
      soldQuantity = resultado.soldQuantity;
      if (dateCreated === null) dateCreated = resultado.dateCreated;
      if (soldQuantity !== null && itemId === null) itemId = itemIdActual;
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
    // doc.URL es la URL real de la página (mismo valor que location.href
    // para el documento que el navegador ya cargó) — de ahí sale el id
    // del producto actual, para no confundirlo con otro de la misma página.
    const itemIdActual = extraerIdDeUrl(doc && doc.URL);
    const incrustado = leerDatosIncrustados(htmlCompleto, itemIdActual);
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
      // itemIdActual ya viene validado por extraerIdDeUrl (patrón
      // MCO\d+) — construirLinkSeguirProducto lo vuelve a validar
      // igual, nunca confía en que ya se validó antes.
      linkSeguir: construirLinkSeguirProducto(itemIdActual),
    };
  }

  function leerTienda(doc) {
    const htmlCompleto = doc && doc.documentElement ? doc.documentElement.outerHTML : "";
    const sellerId = leerSellerIdDeTienda(htmlCompleto, doc && doc.URL);
    return {
      nombreTienda: U.textoDe(["h1", ".ui-seller-info__title", ".store-header__title"], doc),
      sellerId,
      linkSeguir: construirLinkSeguirTienda(sellerId),
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

  const api = {
    tipoDePagina,
    leerProducto,
    leerListado,
    leerTienda,
    leerDatosIncrustados,
    calcularVentasPromedioMes,
    extraerIdDeUrl,
    construirLinkSeguirProducto,
    construirLinkSeguirTienda,
    leerSellerIdDeTienda,
    extraerCustIdDeUrl,
  };

  // Igual que extension/seguridad.js: en el navegador real no existe
  // `module` — este bloque solo corre cuando vitest hace require()/
  // import() del archivo, sin navegador.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixLectorActivo = { sitio: "Mercado Libre Colombia", tipoDePagina, leerProducto, leerListado, leerTienda };
  }
})();
