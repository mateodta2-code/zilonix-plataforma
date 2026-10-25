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

  // "Ventas promedio al mes" = vendidos AJUSTADO × 30 ÷ días desde la
  // publicación — siempre un ESTIMADO (lo pide la tarea explícito),
  // nunca una cifra que Mercado Libre confirme directamente. `vendidos`
  // puede ser el exacto (sold_quantity) o el aproximado de "+N
  // vendidos" — lo único obligatorio es `dateCreated`, que solo sale
  // del JSON incrustado (nunca de la interfaz visible).
  //
  // Issue #197 (Sharel, "estilo Selltrix"): "no dejar ventas en cero"
  // — el vendidos crudo se ajusta antes de convertirlo en tasa
  // mensual, para compensar un sesgo conocido hacia abajo. El primero
  // que aplique, nunca los dos juntos:
  //   - ×2.2 si es Full: más visibilidad/velocidad de venta de la que
  //     refleja el promedio histórico completo.
  //   - ×1.55 si vendidos viene de la etiqueta redondeada "+N
  //     vendidos" (vendidosExacto === false), nunca del sold_quantity
  //     real — esa etiqueta es un piso, no el número real.
  //   - ×1 si vendidos es exacto y no es Full.
  // Mismo criterio y mismos factores que lib/ml/estimacionVentas.ts
  // (lado del servidor, /panel/investigacion) — para que "estimado"
  // signifique lo mismo en los dos lados.
  function calcularVentasPromedioMes(vendidos, dateCreated, ahoraMs, esFull, vendidosExacto) {
    if (typeof vendidos !== "number" || !Number.isFinite(vendidos) || !dateCreated) return null;
    const creadoMs = new Date(dateCreated).getTime();
    if (!Number.isFinite(creadoMs)) return null;
    const ahora = typeof ahoraMs === "number" ? ahoraMs : Date.now();
    // Mínimo 1 día — una publicación de hoy mismo no puede dividir por 0
    // ni dar un promedio mensual absurdamente alto por una fecha futura mal leída.
    const diasTranscurridos = Math.max(1, Math.round((ahora - creadoMs) / 86_400_000));
    const factor = esFull ? 2.2 : vendidosExacto === false ? 1.55 : 1;
    return Math.round(((vendidos * factor * 30) / diasTranscurridos) * 10) / 10;
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
    // Issue #197 — calculado ACÁ (no más abajo, donde antes vivía
    // inline en el objeto de retorno) para poder pasarlo al ajuste
    // "estilo Selltrix" de calcularVentasPromedioMes.
    const esFull = /\bfull\b/i.test(textoEnvio);

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
      ventasPromedioMes: calcularVentasPromedioMes(vendidos, incrustado.dateCreated, undefined, esFull, vendidosExacto),
      vendedor: U.textoDe([".ui-pdp-seller__header__title", ".ui-pdp-seller__link-trigger-button", "a.ui-pdp-seller__link-trigger-button"], doc),
      calificacion: U.calificacionDesdeTexto(U.textoDe([".ui-pdp-review__rating", ".ui-review-capability__rating__average"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe([".ui-pdp-review__amount", ".ui-review-capability__rating__amount"], doc)),
      esCatalogo: tieneBuybox,
      esFull,
      envioGratis: /envío\s*gratis|envio\s*gratis/i.test(textoEnvio),
      // itemIdActual ya viene validado por extraerIdDeUrl (patrón
      // MCO\d+) — construirLinkSeguirProducto lo vuelve a validar
      // igual, nunca confía en que ya se validó antes.
      linkSeguir: construirLinkSeguirProducto(itemIdActual),
      // Issue #210 — "Completar vendidos": itemId/dateCreated, para que
      // content.js pueda mandarle este dato al panel de Investigación
      // (que necesita el itemId para saber a qué fila de la tabla
      // corresponde, y dateCreated para estimar ventas/mes del mismo
      // modo que lib/ml/estimacionVentas.ts). Nunca se inventa: mismo
      // itemIdActual ya validado arriba, y dateCreated sale de
      // leerDatosIncrustados (null si no se pudo confirmar).
      itemId: itemIdActual,
      dateCreated: incrustado.dateCreated,
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

  // Issue #227 — "quitar API de Investigación": Demanda/Mercado/Estrategia
  // dejan de depender de la API de catálogo (buscarInvestigacionProducto) —
  // ahora el dato real sale de ACÁ, el listado real de Mercado Libre, con
  // la misma ambición de volumen/calidad que Selltrix/Zilonix OS (smoke de
  // Sharel: Seller mostraba ~6 "Sin dato" contra ~24-40 de Selltrix/OS).
  //
  // Estructura real confirmada en vivo por Cowork (zilonix-os-web,
  // chrome-extension-busqueda/scraper-listado.js) — NO adivinada:
  //   li.ui-search-layout__item
  //     img.poly-component__picture                         (foto)
  //     a.poly-component__title                              (título + link)
  //     span.poly-component__seller                          (vendedor, opcional)
  //     span.andes-visually-hidden con "Calificación X de 5
  //       estrellas. Más de N productos vendidos."            (calificación + vendidos juntos —
  //                                                              más confiable que los spans visibles sueltos)
  //     .poly-price__current .poly-price__amount[aria-label]  (precio, en el aria-label)
  //     svg[aria-label="Enviado por FULL"]                    (badge Full)
  //     a.poly-component__ads-promotions / [aria-label="Promocionado"]  (anuncio — se excluye)
  //
  // El link del título trae 3 formatos reales distintos — se clasifican
  // para poder armar un itemId confiable (solo ese habilita "Seguir",
  // issue #227 punto 9 "Seguir solo ML"): catálogo (/p/MCO...) y "user
  // product" (/up/MCOU...) NO son itemId de publicación real, quedan
  // sin itemId (nunca se inventa uno).
  function clasificarLinkListadoMl(href) {
    if (!href) return null;
    let m = href.match(/\/p\/(MCO\d+)/);
    if (m) return { tipo: "producto", id: m[1] };
    m = href.match(/\/up\/(MCOU\d+)/);
    if (m) return { tipo: "user_product", id: m[1] };
    m = href.match(/MCO-?(\d{9,})/);
    if (m) return { tipo: "item", id: `MCO${m[1]}` };
    return null;
  }

  function precioDesdeAriaLabel(tarjeta) {
    const span = U.primerElemento([".poly-price__current .poly-price__amount", ".poly-price__amount"], tarjeta);
    const label = span ? span.getAttribute("aria-label") || "" : "";
    const digitos = label.replace(/[^\d]/g, "");
    return digitos ? Number(digitos) : null;
  }

  // Calificación + vendidos vienen JUNTOS en un solo span de
  // accesibilidad (oculto visualmente) — confirmado por Cowork como
  // más confiable que los spans visibles sueltos.
  function leerCalificacionYVendidosListado(tarjeta) {
    const candidatos = tarjeta.querySelectorAll("span.andes-visually-hidden");
    for (const s of candidatos) {
      const texto = (s.textContent || "").trim();
      const mEst = texto.match(/Calificaci[oó]n\s+([\d.,]+)\s+de\s+5/i);
      if (!mEst) continue; // este span oculto es de otra cosa (precio, badge, etc.) — se sigue buscando
      const estrellas = parseFloat(mEst[1].replace(",", "."));
      const mVend = texto.match(/(?:[Mm]ás de\s+)?([\d.,]+)\+?\s*productos?\s+vendid/i);
      const vendidos = mVend ? Number(mVend[1].replace(/\./g, "").replace(",", "")) : null;
      return { estrellas: Number.isFinite(estrellas) ? estrellas : null, vendidos };
    }
    return { estrellas: null, vendidos: null };
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("li.ui-search-layout__item");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const linkEl = U.primerElemento(["a.poly-component__title"], tarjeta);
      const href = linkEl ? linkEl.getAttribute("href") : null;
      const idInfo = clasificarLinkListadoMl(href);
      if (!idInfo) return; // sin forma de identificar la publicación, se descarta — nunca se inventa

      const esAnuncio = Boolean(U.primerElemento(['a.poly-component__ads-promotions', 'a[aria-label="Promocionado"]'], tarjeta));
      if (esAnuncio) return; // mismo criterio que las otras 5 plataformas: nunca mezcla pago con orgánico

      // Issue #229 — hotfix de smoke: Sharel reportó TODO marcado "No"
      // (nunca "Full") a pesar de publicaciones Full reales visibles.
      // El selector original (exact-match, case-sensitive) seguía
      // siendo el confirmado por Cowork en zilonix-os-web — la mejora
      // acá es puramente defensiva, no una reescritura a ciegas: se
      // suma la bandera CSS "i" (case-insensitive, soportada en Chrome,
      // el único navegador que corre esta extensión) para no perder el
      // match si el aria-label real viene con otra capitalización
      // ("Enviado por Full"), más un respaldo por substring (cualquier
      // elemento cuyo aria-label contenga a la vez "envi" y "full" —
      // nunca solo "full" suelto, para no confundir con un título de
      // producto tipo "Full HD"). Esta sesión no pudo confirmar en vivo
      // el HTML real de hoy (listado.mercadolibre.com.co bloqueó el
      // fetch directo con una verificación de cuenta, y el fetch con
      // IA también dio 403) — si Sharel sigue viendo "No" en el próximo
      // smoke, hace falta inspeccionar el HTML real a mano y ajustar
      // este selector con ese dato confirmado, nunca adivinar de nuevo.
      const esFull = Boolean(
        U.primerElemento(['svg[aria-label="Enviado por FULL" i]', '[aria-label*="envi" i][aria-label*="full" i]'], tarjeta)
      );
      const { estrellas, vendidos } = leerCalificacionYVendidosListado(tarjeta);
      const fotoEl = U.primerElemento(["img.poly-component__picture"], tarjeta);

      productos.push({
        titulo: (linkEl && linkEl.textContent ? linkEl.textContent.trim() : "") || null,
        precio: precioDesdeAriaLabel(tarjeta),
        // Issue #229 — "thumbnails reales": el listado carga las fotos
        // con lazy-load (mismo patrón ya confirmado en Shein, issue
        // #227) — `src` suele ser todavía el placeholder cuando este
        // script lee la tarjeta antes de que haga scroll a la vista;
        // `data-src` es la URL real. Se prueba esa primero.
        foto: fotoEl ? fotoEl.getAttribute("data-src") || fotoEl.getAttribute("src") : null,
        vendedor: U.textoDe([".poly-component__seller"], tarjeta),
        calificacion: estrellas,
        vendidos,
        esFull,
        // Solo un link de tipo "item" (publicación real) da un itemId
        // real — catálogo/user_product quedan sin itemId, nunca
        // inventado (ver clasificarLinkListadoMl arriba).
        itemId: idInfo.tipo === "item" ? idInfo.id : null,
        link: href || null,
      });
    });
    return { productos };
  }

  // Issue #225 — "Top 8 reseñas": fuente real confirmada en vivo por
  // Cowork (zilonix-os-web, chrome-extension-busqueda/scraper-pdp-resenas.js,
  // PDP de ejemplo /cargador-reparador-de-baterias-de-12v-para-carros-y-motos/p/MCO52860384):
  //   <script id="__NORDIC_RENDERING_CTX__">_n.ctx.r={...428KB...},styles:new Set([])};</script>
  // Marcador DISTINTO del que usa leerDatosIncrustados (arriba): ese
  // busca "window.__NORDIC_RENDERING_CTX__ = {...}" como asignación de
  // variable dentro del HTML completo; este es un <script id="..."> con
  // "_n.ctx.r=" adentro — nunca se asume que son el mismo blob sin
  // haberlo confirmado así, puntual, en producción (de ahí el extractor
  // de llaves balanceadas aparte, aunque la lógica sea la misma idea).
  // Rutas confirmadas (o = objeto parseado):
  //   base = o.appProps.pageProps.initialState
  //   R = base.components.reviews_capability_v3
  //     R.rating.amount   -> total exacto de opiniones
  //     R.rating.average  -> promedio
  //     R.rating.levels[] -> index 0 = 5★ … index 4 = 1★ ({value, percentage, index})
  //     R.reviews[]       -> SOLO las primeras (no todas): .rating, .comment.date ("Hace 3 meses"), .comment.country, .comment.content.text
  // API ML de reseñas (/reviews/item/{id}) da 403 para publicaciones
  // ajenas (confirmado en vivo) — por eso se lee del HTML, nunca de esa
  // API.
  function extraerObjetoJsonDesde(texto, inicio) {
    let profundidad = 0;
    let dentroDeString = false;
    let escapando = false;
    for (let i = inicio; i < texto.length; i++) {
      const c = texto[i];
      if (dentroDeString) {
        if (escapando) escapando = false;
        else if (c === "\\") escapando = true;
        else if (c === '"') dentroDeString = false;
        continue;
      }
      if (c === '"') {
        dentroDeString = true;
        continue;
      }
      if (c === "{") profundidad++;
      else if (c === "}") {
        profundidad--;
        if (profundidad === 0) return texto.slice(inicio, i + 1);
      }
    }
    return null; // nunca se cerró — script cortado a mitad de carga, u otra forma inesperada
  }

  // "Hace 3 meses"/"Hace una semana"/"Hace 11 meses" -> días aprox. —
  // Mercado Libre solo da fecha RELATIVA en las reseñas visibles, nunca
  // una fecha exacta — a propósito una aproximación (mismo criterio y
  // mismo regex que zilonix-os-web), se avisa en el panel.
  function diasDesdeTextoRelativo(texto) {
    if (!texto) return null;
    const m = String(texto).match(/Hace\s+(\d+|un|una)\s+(día|dias|días|semana|semanas|mes|meses|año|anos|años)/i);
    if (!m) return null;
    const n = /^\d+$/.test(m[1]) ? parseInt(m[1], 10) : 1;
    const unidad = m[2].toLowerCase();
    if (unidad.startsWith("d")) return n;
    if (unidad.startsWith("sem")) return n * 7;
    if (unidad.startsWith("mes")) return n * 30;
    return n * 365; // año/años/anos
  }

  const RESENAS_VACIAS = { resenasTotales: null, promedio: null, positivas: 0, negativas: 0, resenasVisibles: 0, recientes30: 0, recientes90: 0 };

  // Puro — recibe el textContent del <script id="__NORDIC_RENDERING_CTX__">
  // ya leído (nunca el DOM acá, para poder probarlo con vitest sin
  // navegador, mismo criterio que leerDatosIncrustados).
  function leerResenasDesdeScript(textoScript) {
    if (typeof textoScript !== "string" || !textoScript) return RESENAS_VACIAS;
    const marcador = "_n.ctx.r=";
    const idxMarcador = textoScript.indexOf(marcador);
    if (idxMarcador === -1) return RESENAS_VACIAS;
    const idxLlave = textoScript.indexOf("{", idxMarcador + marcador.length);
    if (idxLlave === -1) return RESENAS_VACIAS;
    const jsonTexto = extraerObjetoJsonDesde(textoScript, idxLlave);
    if (!jsonTexto) return RESENAS_VACIAS;
    try {
      const datos = JSON.parse(jsonTexto);
      const R = datos?.appProps?.pageProps?.initialState?.components?.reviews_capability_v3;
      if (!R) return RESENAS_VACIAS;
      const levels = R.rating?.levels || [];
      const porIndex = (i) => levels.find((l) => l.index === i)?.value || 0;
      const positivas = porIndex(0) + porIndex(1); // 5★+4★ (confirmado por Cowork)
      const negativas = porIndex(3) + porIndex(4); // 2★+1★
      const reviews = R.reviews || [];
      const diasPorResena = reviews.map((r) => diasDesdeTextoRelativo(r?.comment?.date)).filter((d) => d != null);
      return {
        resenasTotales: typeof R.rating?.amount === "number" ? R.rating.amount : null,
        promedio: typeof R.rating?.average === "number" ? R.rating.average : null,
        positivas,
        negativas,
        // Solo de las reseñas VISIBLES en la PDP (R.reviews, no todas las
        // que existen) — si el total real es mayor, esto es un piso,
        // nunca el dato completo. Se avisa en el panel.
        resenasVisibles: reviews.length,
        recientes30: diasPorResena.filter((d) => d <= 30).length,
        recientes90: diasPorResena.filter((d) => d <= 90).length,
      };
    } catch {
      return RESENAS_VACIAS; // JSON cortado o forma inesperada — nunca revienta, nunca inventa
    }
  }

  function leerResenas(doc) {
    const script = doc && doc.querySelector ? doc.querySelector("script#__NORDIC_RENDERING_CTX__") : null;
    return leerResenasDesdeScript(script ? script.textContent : "");
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
    leerResenas,
    leerResenasDesdeScript,
  };

  // Igual que extension/seguridad.js: en el navegador real no existe
  // `module` — este bloque solo corre cuando vitest hace require()/
  // import() del archivo, sin navegador.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixLectorActivo = { sitio: "Mercado Libre Colombia", tipoDePagina, leerProducto, leerListado, leerTienda, leerResenas };
  }
})();
