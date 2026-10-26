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

  // Issue #233 — bug real confirmado en el smoke de Sharel: "panel
  // sigue sin bloques, escaneo → 0 productos" en Argentina/Brasil/etc.
  // Causa real: todo este archivo asumía el site-id de Mercado Libre
  // COLOMBIA (MCO) a mano, en 4 lugares distintos — un id real de
  // cualquier otro país (MLA=Argentina, MLB=Brasil, MLM=México,
  // MLC=Chile, MLU=Uruguay, MPE=Perú — site-ids públicos y reales de
  // Mercado Libre, no un detalle interno de scraping, mismo criterio
  // que ya usan los dominios de DOMINIOS_ML_PAIS en background.js,
  // issue #227) nunca matcheaba "MCO", así que `clasificarLinkListadoMl`
  // descartaba la tarjeta ENTERA (`if (!idInfo) return;`, más abajo) —
  // para Argentina/Brasil/México/Chile/Uruguay/Perú, TODAS las
  // tarjetas de un listado se perdían así, sin importar si la lectura
  // en sí funcionaba bien. Una sola constante compartida para los 4
  // lugares, para no repetir el patrón ni arriesgar que uno quede
  // desactualizado si se agrega un país nuevo el día de mañana.
  const PREFIJO_ITEM_ML = "MCO|MLA|MLB|MLM|MLC|MLU|MPE";

  function tipoDePagina(url) {
    if (new RegExp(`/(p/)?(?:${PREFIJO_ITEM_ML})-?\\d+`, "i").test(url) || /articulo\.(mercadolibre|mercadolivre)/i.test(url)) return "producto";
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
    if (/\/perfil\/|tienda\.(mercadolibre|mercadolivre)|\/tienda\/|[?&]CustId=/i.test(url)) return "tienda";
    // Issue #233, punto B — bug real confirmado por Sharel: Brasil usa
    // el dominio "mercadolivre" (marca real en portugués — mismo
    // dominio que ya arma `urlListadoMl` en background.js desde #227),
    // nunca "mercadolibre". Esta función solo reconocía "mercadolibre"
    // acá, así que una URL real de listado de Brasil devolvía `null` —
    // ni siquiera llegaba a intentar `leerListado`, 0 productos
    // garantizado, independiente de si clasificarLinkListadoMl
    // funcionaba o no.
    //
    // Issue #235 — bug real APARTE, encontrado después de #233 (el
    // panel seguía sin bloque de Brasil aunque #233 ya reconocía el
    // dominio): el SUBDOMINIO también es distinto en portugués.
    // Confirmado con evidencia real (Wayback Machine, nunca adivinado
    // — listado.mercadolibre.com.co bloquea el acceso directo desde
    // este sandbox, pero archive.org no dispara ese bloqueo):
    // `listado.mercadolibre.com.ar` SÍ existe (confirma que el resto
    // de países hispanohablantes usan "listado"), `listado.mercadolivre.com.br`
    // JAMÁS tuvo una captura real, pero `lista.mercadolivre.com.br`
    // SÍ tiene una captura real con tarjetas reales adentro — Brasil
    // usa "lista" (portugués), nunca "listado" (español). `urlListadoMl`
    // (background.js) ya arma la URL real con el subdominio correcto
    // por país (`DOMINIOS_ML_PAIS[pais].subdominioListado`) — acá se
    // suma el reconocimiento de "lista." (solo para mercadolivre,
    // nunca para mercadolibre: esa combinación no existe).
    if (/listado\.mercadolibre|lista\.mercadolivre|\/search|[?&]q=/i.test(url)) return "listado";
    return null;
  }

  // Issue #174 — "Seguir en Zilonix": el panel de producto/tienda abre,
  // SOLO por clic real de la persona (nunca solo), una pestaña nueva
  // hacia Zilonix Seller con el id a agregar al seguimiento. El id
  // SIEMPRE se valida y se encodea antes de armar el link — nunca se
  // pega un id (de la URL o del HTML) directo a una URL.
  // Issue #233 — antes solo validaba MCO (Colombia); "Seguir en
  // Zilonix" en un producto de cualquier otro país nunca construía un
  // link real (`construirLinkSeguirProducto` devolvía `null` siempre).
  const PATRON_ID_ITEM = new RegExp(`^(?:${PREFIJO_ITEM_ML})\\d+$`);
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

  // "MCO-123456789"/"MLA-123456789"/etc (con o sin guión) ->
  // "MCO123456789"/"MLA123456789". Issue #233 — antes solo reconocía
  // MCO: en una página de producto de Argentina/Brasil/etc, `itemIdActual`
  // quedaba siempre `null`, lo que rompía `leerDatosIncrustados`
  // (nunca podía amarrar sold_quantity al producto real),
  // "Completar vendidos" (nunca mandaba nada) y "Seguir en Zilonix"
  // (`construirLinkSeguirProducto` también necesitaba un id real).
  function extraerIdDeUrl(url) {
    if (typeof url !== "string") return null;
    const m = url.match(new RegExp(`(${PREFIJO_ITEM_ML})-?(\\d+)`, "i"));
    return m ? `${m[1].toUpperCase()}${m[2]}` : null;
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

  // Busca, en cualquier nivel de profundidad de `obj`, el valor de la
  // primera clave `clave` que encuentre (usada para "quantity_selector",
  // issue #251 — ver el comentario de inventarioSelector más abajo).
  // Sin amarre a itemIdActual a propósito: este componente del buybox
  // solo existe para el producto que el usuario está viendo (los
  // productos recomendados se renderizan como tarjetas simples, sin su
  // propio quantity_selector) — confirmado contra la ficha real de
  // MCO1050084400 (archive.org, mayo/2026).
  function buscarPorClave(obj, clave, visitados) {
    visitados = visitados || new Set();
    if (!obj || typeof obj !== "object" || visitados.has(obj)) return undefined;
    visitados.add(obj);
    if (!Array.isArray(obj) && Object.prototype.hasOwnProperty.call(obj, clave)) return obj[clave];
    const valores = Array.isArray(obj) ? obj : Object.values(obj);
    for (const valor of valores) {
      const resultado = buscarPorClave(valor, clave, visitados);
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
    const vacio = { soldQuantity: null, itemId: null, dateCreated: null, inventarioSelector: null };
    if (typeof html !== "string" || !html || !itemIdActual) return vacio;

    let soldQuantity = null;
    let itemId = null;
    let dateCreated = null;
    let inventarioSelector = null;

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
        // Issue #251 (revisión de Pablo) — probado contra evidencia real
        // (archive.org, mayo/2026, MCO1050084400, el mismo item que ya
        // documenta leerInventarioMaximoDeTexto): el
        // "quantity_selector.available_quantity" del JSON incrustado NO
        // es el stock real — es el número de filas del dropdown de
        // cantidad, SIEMPRE igual a "selector.rows" y capado a 6 por UX
        // (ese item mostraba available_quantity:6 mientras el texto real
        // decía "(+10 disponibles)", y Mateo confirmó en vivo que de
        // verdad se podían comprar 27 — el tope real nunca aparece en la
        // página sin interactuar, así que no hay forma de leerlo acá).
        // Solo sirve como EXACTO cuando el stock real es BAJO: ahí el
        // dropdown nunca llega a su tope de 6 filas, así que coincide
        // con el disponible real — confirmado con otra ficha real
        // (archive.org, junio/2025, MCO1002047025: available_quantity:2,
        // texto "2 disponibles" sin "+", exacto). leerProducto (abajo)
        // es quien decide cuándo usarlo — acá solo se extrae el número
        // crudo, nunca se interpreta.
        // Issue #251 (corrección de Pablo, punto 10) — bug real: una
        // página con productos recomendados/relacionados puede traer
        // VARIOS "quantity_selector" en el mismo JSON incrustado, uno
        // por tarjeta — buscar sin amarre (como antes) podía devolver
        // el de un producto DISTINTO si ese aparecía primero en el
        // árbol. Ahora se busca PRIMERO dentro del objeto ya amarrado
        // al item actual (`objetoDelItem`, el mismo que da sold_quantity/
        // date_created arriba); solo si ESE objeto no tiene su propio
        // quantity_selector se cae al árbol completo (el caso real
        // confirmado de MCO1050084400, donde el selector no vive
        // anidado dentro del objeto del item) — nunca al revés.
        const quantitySelector = (objetoDelItem && buscarPorClave(objetoDelItem, "quantity_selector")) || buscarPorClave(datos, "quantity_selector");
        if (quantitySelector && typeof quantitySelector.available_quantity === "number" && Number.isFinite(quantitySelector.available_quantity)) {
          inventarioSelector = quantitySelector.available_quantity;
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

    return { soldQuantity, itemId, dateCreated, inventarioSelector };
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

  // Issue #245 — Mateo confirmó leyendo Zilonix OS hoy
  // (chrome-extension-busqueda/scraper-listado.js) que ese repo NO
  // tiene ningún detector de Full en la ficha de producto — solo en
  // el listado, con este selector exacto, ya confirmado en producción:
  //   const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  // El intento de #243 (detectarFullEnHtmlEnvio, acotado a un bloque
  // de envío resuelto con selectores nunca confirmados en producción
  // de verdad) era la corrección equivocada: si ese bloque no se
  // resolvía, `esFull` caía siempre a `false` sin importar si el
  // badge real estaba visible — exactamente el bug que reportó Sharel
  // con "Zelotes F35" en 0.3.17. Acá se copia el MISMO selector de OS,
  // tal cual, sin un bloque de envío como gate obligatorio.
  function detectarFullEnHtmlFicha(htmlFicha) {
    if (typeof htmlFicha !== "string" || !htmlFicha) return false;
    // Match EXACTO del aria-label, igual que el selector de atributo
    // de OS (`[aria-label="Enviado por FULL"]` en CSS es exacto, no
    // substring) — nunca un "full" suelto que confunda con un título
    // real tipo "Full HD".
    return /<svg\b[^>]*\baria-label\s*=\s*["']Enviado por FULL["'][^>]*>/i.test(htmlFicha);
  }

  function leerProducto(doc) {
    // Issue #243 — selectores reales confirmados contra una ficha real
    // (CDX/Wayback, mayo/2026); los viejos (.ui-pdp-shipping /
    // .ui-pdp-container__col--shipping) quedan de respaldo, nunca
    // confirmados vigentes hoy pero tampoco descartados por si alguna
    // variante de categoría/país todavía los usa. Issue #245 — esto ya
    // NO decide esFull (ver más abajo): solo sirve para envioGratis y,
    // cuando existe, como zona segura para buscar el badge Full sin
    // agarrar el de un producto DISTINTO en el carrusel de
    // "productos relacionados" de la misma página (se confirmó el
    // mismo ícono ahí en #243).
    const bloqueEnvio = U.primerElemento(
      [
        ".ui-pdp-container__row--shipping-summary",
        ".ui-vpp-shipping_summary",
        "#shipping_summary",
        ".ui-pdp-shipping",
        ".ui-pdp-container__col--shipping",
      ],
      doc
    );
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
    // Issue #245 — Zilonix OS confirmó que NO tiene detector de Full
    // en la ficha, solo en el listado (ver comentario completo sobre
    // detectarFullEnHtmlFicha, arriba). #243 gateaba esFull a `false`
    // si bloqueEnvio no se resolvía — ESE era el bug real que reportó
    // Sharel con Zelotes F35 en 0.3.17, no el regex. Acá nunca hay un
    // gate a `false`: se busca el badge primero en bloqueEnvio (si se
    // resolvió, para no agarrar el de un producto distinto del
    // carrusel de "relacionados") y, si no, en la ficha completa —
    // igual que el criterio simple de OS, que en el listado nunca
    // necesita este respaldo porque cada tarjeta ya viene separada.
    const esFull = detectarFullEnHtmlFicha(bloqueEnvio ? bloqueEnvio.outerHTML : htmlCompleto);
    // Issue #251 — Mercado Libre nunca deja ver `available_quantity`
    // real de una publicación AJENA por la API (403/ausente,
    // confirmado en #250) — se lee de la FICHA abierta en pantalla en
    // su lugar. Selector real confirmado (archive.org, snapshot de
    // una ficha real de Mercado Libre Colombia, mayo/2026 — acceso
    // directo sigue bloqueado desde este sandbox):
    //   <span class="ui-pdp-buybox__quantity__available">(+10 disponibles)</span>
    // dentro de #buybox_available_quantity. Mismo criterio que "+N
    // vendidos" (abajo, ya confirmado desde #174): un número con "+"
    // es un piso, nunca el disponible exacto — se marca `aproximado`
    // igual que ya hace lector.ts del lado del servidor para un
    // recurso ajeno (inventarioAproximado).
    const inventarioTexto = leerInventarioMaximoDeTexto(U.textoDe([".ui-pdp-buybox__quantity__available"], doc));
    const inventario = elegirInventarioPrincipal(inventarioTexto, incrustado.inventarioSelector);

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
      // Issue #251 — null cuando el selector de cantidad no aparece
      // (ej. sin stock, o un tipo de publicación distinto) — nunca
      // 0 inventado en su lugar.
      inventarioMaximo: inventario.valor,
      inventarioMaximoAproximado: inventario.aproximado,
    };
  }

  // Issue #251 — puro (string de texto -> {valor, aproximado}), para
  // poder probarlo con un fixture real sin DOM. "(+10 disponibles)" ->
  // {valor: 10, aproximado: true} (el "+" es un piso real de Mercado
  // Libre, igual que "+N vendidos" — nunca el disponible exacto).
  // "5 disponibles" (sin "+", stock bajo) -> {valor: 5, aproximado:
  // false} — forma simétrica a como ya se trata "vendidos" en este
  // mismo archivo, documentada así aunque todavía no se confirmó un
  // ejemplo real sin "+" (ningún producto de bajo stock apareció en
  // la evidencia reunida para este issue).
  function leerInventarioMaximoDeTexto(texto) {
    if (typeof texto !== "string" || !texto) return { valor: null, aproximado: false };
    const m = texto.match(/(\+)?\s*([\d.,]+)\s*disponibles?/i);
    if (!m) return { valor: null, aproximado: false };
    const valor = U.enteroDesdeTexto(m[2]);
    return { valor, aproximado: Boolean(m[1]) };
  }

  // Issue #251 (revisión de Pablo + corrección de Mateo) — puro, para
  // poder probarlo sin DOM. El texto "(+N disponibles)" sigue siendo el
  // valor PRINCIPAL (ver el comentario completo en leerDatosIncrustados
  // sobre por qué `quantity_selector.available_quantity` del JSON
  // incrustado NO es el stock real: es el tope de filas del dropdown,
  // confirmado contra evidencia real — MCO1050084400, mayo/2026,
  // available_quantity:6 mientras el stock real era "10 o más", Mateo
  // confirmó en vivo que de verdad se podían comprar 27).
  // TOPE_FILAS_SELECTOR=6 es ese tope real del dropdown — por debajo de
  // eso el stock nunca necesita un "+" para mostrarse, así que ahí el
  // número del selector SÍ coincide con el disponible real (confirmado
  // con MCO1002047025, junio/2025: available_quantity:2 == "2
  // disponibles" sin "+", exacto).
  const TOPE_FILAS_SELECTOR_CANTIDAD = 6;
  function elegirInventarioPrincipal(inventarioTexto, inventarioSelector) {
    if (inventarioSelector !== null && inventarioSelector < TOPE_FILAS_SELECTOR_CANTIDAD && !inventarioTexto.aproximado) {
      return { valor: inventarioSelector, aproximado: false };
    }
    return inventarioTexto;
  }

  function leerTienda(doc) {
    const htmlCompleto = doc && doc.documentElement ? doc.documentElement.outerHTML : "";
    const sellerId = leerSellerIdDeTienda(htmlCompleto, doc && doc.URL);
    const publicaciones = leerPublicacionesTienda(doc);
    return {
      nombreTienda: U.textoDe(["h1", ".ui-seller-info__title", ".store-header__title"], doc),
      sellerId,
      linkSeguir: construirLinkSeguirTienda(sellerId),
      // Issue #251 — null cuando la página de tienda no trae el
      // listado real (ej. la landing de una tienda oficial, antes de
      // entrar a "Todos los productos") — nunca 0 inventado.
      totalPublicaciones: publicaciones.total,
      idsVisibles: publicaciones.idsVisibles,
    };
  }

  // Issue #251 — Mercado Libre da 403 real al listar las publicaciones
  // de un vendedor AJENO por la API (confirmado en #250) — se lee del
  // LISTADO de la tienda abierto en pantalla. Selectores reales
  // confirmados (archive.org, listado.mercadolibre.com.co/tienda/samsung/,
  // snapshot de junio/2025 — acceso directo sigue bloqueado desde este
  // sandbox): el total viene en
  //   <span class="ui-search-search-result__quantity-results">752 resultados</span>
  // y cada publicación visible es la MISMA tarjeta `li.ui-search-layout__item`
  // que ya lee `leerListado` (abajo) — mismo criterio: el `href` del
  // link del título (`a.poly-component__title`) clasificado con
  // `clasificarLinkListadoMl` (abajo, issue #233), nunca inventado.
  // Issue #251 (revisión de Pablo, punto 8 "tests... del lector de
  // tienda") — puro (texto del total + lista de hrefs -> {total,
  // idsVisibles}), separado de leerPublicacionesTienda a propósito: el
  // resto de este archivo no tiene DOM real en las pruebas (sin jsdom),
  // mismo criterio que leerInventarioMaximoDeTexto/clasificarLinkListadoMl.
  function construirPublicacionesTienda(totalTexto, hrefsVisibles) {
    const total = U.enteroDesdeTexto(totalTexto);
    const idsVisibles = [];
    for (const href of hrefsVisibles || []) {
      const idInfo = clasificarLinkListadoMl(href);
      if (idInfo) idsVisibles.push(idInfo.id);
    }
    return { total, idsVisibles };
  }

  function leerPublicacionesTienda(doc) {
    const totalTexto = U.textoDe([".ui-search-search-result__quantity-results"], doc);
    const tarjetas = doc.querySelectorAll("li.ui-search-layout__item");
    const hrefsVisibles = [];
    tarjetas.forEach((tarjeta) => {
      const linkEl = U.primerElemento(["a.poly-component__title"], tarjeta);
      hrefsVisibles.push(linkEl ? linkEl.getAttribute("href") : null);
    });
    return construirPublicacionesTienda(totalTexto, hrefsVisibles);
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
  //
  // Issue #233 — bug real confirmado por el smoke de Sharel: los 3
  // patrones de acá solo reconocían el prefijo MCO (Colombia) — un id
  // real de cualquier otro país (MLA/MLB/MLM/MLC/MLU/MPE, ver
  // PREFIJO_ITEM_ML arriba) nunca matcheaba NINGUNO de los 3, así que
  // `idInfo` daba `null` y la tarjeta se descartaba ENTERA (`if
  // (!idInfo) return;`, en leerListado) — para Argentina/Brasil/etc,
  // TODAS las tarjetas de un listado real se perdían así, sin importar
  // que la lectura del resto de la tarjeta funcionara bien.
  function clasificarLinkListadoMl(href) {
    if (!href) return null;
    let m = href.match(new RegExp(`/p/((?:${PREFIJO_ITEM_ML})\\d+)`, "i"));
    if (m) return { tipo: "producto", id: m[1].toUpperCase() };
    m = href.match(new RegExp(`/up/((?:${PREFIJO_ITEM_ML})U\\d+)`, "i"));
    if (m) return { tipo: "user_product", id: m[1].toUpperCase() };
    m = href.match(new RegExp(`(${PREFIJO_ITEM_ML})-?(\\d{9,})`, "i"));
    if (m) return { tipo: "item", id: `${m[1].toUpperCase()}${m[2]}` };
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
  // Issue #235, punto 6 — bug real confirmado por Sharel ("filtro
  // 'Mejor calificado' no ordena"): hasta esta tarea, calificación y
  // vendidos se buscaban juntos en el MISMO span oculto, asumiendo que
  // Mercado Libre siempre los pone en un solo texto ("Calificación X
  // de 5. Más de N productos vendidos."). Confirmado contra una
  // captura real de hoy (Wayback Machine, listado.mercadolibre.com.co
  // sigue bloqueando el acceso directo desde este sandbox — mismo
  // criterio que el resto de esta tarea): el texto real de
  // accesibilidad hoy es SOLO "Calificación X de 5 (N calificaciones)"
  // — sin ninguna mención de vendidos en esa misma span; en esa
  // categoría puntual, Mercado Libre ya no muestra ningún número de
  // vendidos en la tarjeta, solo a veces una etiqueta cualitativa
  // "MÁS VENDIDO" (sin cifra — nunca se inventa un número a partir de
  // eso). Acoplar los dos campos a una sola span es frágil ante este
  // tipo de cambio — se separan: cada campo se busca en TODAS las
  // spans ocultas de la tarjeta, de forma independiente, así que un
  // cambio en cómo Mercado Libre arma el texto de vendidos nunca
  // vuelve a arrastrar la calificación con él (ni viceversa).
  function leerCalificacionYVendidosListado(tarjeta) {
    const candidatos = tarjeta.querySelectorAll("span.andes-visually-hidden");
    let estrellas = null;
    let vendidos = null;
    for (const s of candidatos) {
      const texto = (s.textContent || "").trim();
      if (estrellas === null) {
        // Issue #239, punto 4 — bug real confirmado en Brasil: el texto
        // de accesibilidad ahí NUNCA dice "Calificación" (español) —
        // dice "Avaliação X de 5. (N avaliações)" (portugués),
        // confirmado contra una captura real de hoy de
        // lista.mercadolivre.com.br. El regex viejo solo reconocía la
        // palabra en español, así que `estrellas` quedaba siempre
        // `null` para Brasil — nunca un problema de formato del
        // número (la coma decimal "4,7" es igual en los dos idiomas),
        // solo de la palabra. Se suma la alternativa en portugués.
        const mEst = texto.match(/(?:Calificaci[oó]n|Avaliaç[aã]o)\s+([\d.,]+)\s+de\s+5/i);
        if (mEst) {
          const valor = parseFloat(mEst[1].replace(",", "."));
          if (Number.isFinite(valor)) estrellas = valor;
        }
      }
      if (vendidos === null) {
        // Issue #239, punto 4 — generalización defensiva (nunca
        // confirmada contra una tarjeta real con número, español o
        // portugués: tanto Colombia como Brasil, en las categorías
        // revisadas hoy, solo muestran la etiqueta cualitativa "MÁS
        // VENDIDO"/"MAIS VENDIDO" sin ninguna cifra — "vendidos: null"
        // ahí es correcto, no un bug, nunca se inventa un número a
        // partir de esa etiqueta). Se suma "mais de"/"produtos" (PT)
        // junto a "más de"/"productos" (ES) por las dudas de que otra
        // categoría sí muestre el número en portugués — "vendid" es
        // la misma raíz en los dos idiomas, nunca hace falta duplicarla.
        const mVend = texto.match(/(?:(?:[Mm]ás|[Mm]ais)\s+de\s+)?([\d.,]+)\+?\s*(?:productos?|produtos?)\s+vendid/i);
        if (mVend) {
          const valor = Number(mVend[1].replace(/\./g, "").replace(",", ""));
          if (Number.isFinite(valor)) vendidos = valor;
        }
      }
      if (estrellas !== null && vendidos !== null) break; // ya se encontraron los dos — no hace falta seguir mirando el resto de spans
    }
    return { estrellas, vendidos };
  }

  // Issue #242 — confirmado funcionando en producción por Zilonix OS
  // (mateodta2-code/zilonix-os, chrome-extension-busqueda/scraper-listado.js):
  //   const esFull = Boolean(li.querySelector('svg[aria-label="Enviado por FULL"]'));
  // Issue #248 (vueltas 1 a 3) había ensanchado esto en capas de
  // texto/atributos más un diagnóstico temporal, buscando un bug que
  // resultó ser 100% timing (ver content.js, `esperarListadoEstable`)
  // — el HTML real citado en la vuelta 3 confirmó que el selector
  // simple de OS, SOLO, ya reconoce el badge real sin necesitar
  // ninguna capa extra. Issue #248 (vuelta 4) — simplificación pedida
  // por Mateo: se sacan esas capas y el diagnóstico, de vuelta al
  // mismo criterio simple de OS.
  //
  // Mercado Libre Brasil no tiene una confirmación propia disponible
  // (Zilonix OS es solo Colombia, nunca tocó Brasil) — pero "Enviado"
  // y "por" son la misma palabra en español y portugués, y "FULL"
  // nunca se traduce (confirmado en capturas reales de los dos
  // países, issue #239) — se asume el mismo texto para Brasil sin
  // inventar una variante distinta sin evidencia.
  // Issue #240, revisión final antes de mergear — Zilonix OS confirma
  // Full con DOS marcadores reales, no solo uno: el aria-label exacto
  // del ícono SVG (confirmado en producción desde #242) y la clase del
  // ícono del sprite (`icon-poly_full`) — algunas tarjetas (sobre todo
  // anuncios/Ad, que a veces renderizan el badge con otro markup) lo
  // traen solo por la clase, sin el aria-label exacto. Nunca
  // `poly-bookmark__icon-full` (el ícono de favorito, otra cosa por
  // completo) — ese nombre NUNCA contiene el substring literal
  // `icon-poly_full` (compará "icon-poly_full" vs "...__icon-full":
  // el guion bajo entre "poly" y "full" nunca aparece en el de
  // favorito), así que el selector de abajo no lo confunde.
  function detectarFullEnTarjeta(tarjeta) {
    if (!tarjeta) return false;
    return Boolean(U.primerElemento(['svg[aria-label="Enviado por FULL"]', '[class*="icon-poly_full"]'], tarjeta));
  }

  // Issue #248 (vuelta 4)/#240 — versión de texto del MISMO criterio de
  // arriba (los dos marcadores), solo para poder probarlo con un
  // fixture real sin DOM (este proyecto no tiene jsdom/happy-dom) —
  // nunca se llama desde ningún camino real: `detectarFullEnTarjeta`
  // (DOM, arriba) es el único detector que corre en producción.
  function detectarFullEnHtmlTarjeta(htmlTarjeta) {
    if (typeof htmlTarjeta !== "string" || !htmlTarjeta) return false;
    if (/<svg\b[^>]*\baria-label\s*=\s*["']Enviado por FULL["'][^>]*>/i.test(htmlTarjeta)) return true;
    return /class\s*=\s*["'][^"']*icon-poly_full[^"']*["']/i.test(htmlTarjeta);
  }

  // Issue #248 (vuelta 2) — señal fuerte y barata, OPCIONAL (un OR
  // sobre el detector real de arriba, nunca su reemplazo): si la URL
  // del listado ya tiene el filtro "Full" de Mercado Libre puesto,
  // TODOS los productos orgánicos de ese listado SON Full por
  // DEFINICIÓN del filtro — no hace falta que ningún selector de DOM
  // lo confirme. Formas reales conocidas del filtro en la URL:
  // "_Envio_FULL" (confirmada en el issue #247) y
  // "shipping_highlighted_fulfillment" (confirmada en #248) — nunca se
  // inventa una tercera sin evidencia.
  const REGEX_FILTRO_FULL_EN_URL = /envio[-_]?full\b|shipping[-_]?highlighted[-_]?fulfillment|full[-_]?fulfillment/i;
  function filtroFullActivoEnUrl(url) {
    return typeof url === "string" && REGEX_FILTRO_FULL_EN_URL.test(url);
  }

  // Issue #248 (vuelta 5) — evidencia real de Pablo (listado "tetero"
  // CO, filtro apagado): ~60 `li` reales, 39 con Full visible (7
  // anuncios + 32 orgánicos) — y el panel seguía en 0/48. Hipótesis
  // confirmada: `esperarListadoEstable` (content.js) medía la
  // cantidad YA FILTRADA (`leerListado(...).productos.length`, sin
  // anuncios/inválidas) para decidir "estable" — ese número puede
  // quedar quieto ANTES de que Mercado Libre termine de hidratar el
  // badge Full DENTRO de cada `li`, aunque la cantidad de tarjetas en
  // sí todavía esté cambiando. Zilonix OS (`esperarTarjetas`) nunca
  // tuvo este problema porque mide la cantidad CRUDA de `li` en el
  // DOM, antes de cualquier filtro — se expone esa misma cuenta cruda
  // acá para que `content.js` pueda usarla igual, sin que
  // `esperarListadoEstable` deje de ser genérico para las otras 5
  // plataformas (si el lector activo no expone esta función, cae de
  // vuelta a `productos.length`, el criterio de siempre).
  function contarTarjetasListado(doc) {
    return doc.querySelectorAll("li.ui-search-layout__item").length;
  }

  function leerListado(doc) {
    // Issue #248 (vuelta 2) — ver filtroFullActivoEnUrl arriba: si el
    // filtro Full de la URL está puesto, se calcula UNA vez por
    // listado, nunca por tarjeta.
    const filtroFullActivo = filtroFullActivoEnUrl(doc && doc.URL);
    const tarjetas = doc.querySelectorAll("li.ui-search-layout__item");
    const productos = [];
    // Issue #248 (vuelta 6) — decisión de producto de Sharel, con
    // evidencia real: listado de teteros CO sin filtro, ~60 tarjetas
    // = ~12 Ad (la mayoría con el badge Full real visible) + ~48
    // orgánicos (~0-1 Full). `productos` nunca incluye Ads (regla de
    // siempre, nunca mezclar pago con orgánico) — así que contar Full
    // SOLO sobre `productos` daba un "0/48" técnicamente correcto pero
    // engañoso, con badges Full bien visibles en pantalla (los de los
    // Ad). `estadisticasFull` cuenta sobre TODAS las tarjetas
    // (orgánicos + Ad) — nunca se usa para decidir qué entra a
    // `productos`, solo para este número aparte.
    let tarjetasConFull = 0;
    tarjetas.forEach((tarjeta) => {
      // Issue #242/#248 — ver `detectarFullEnTarjeta`/
      // `filtroFullActivoEnUrl` arriba. Si el filtro de la URL ya
      // confirma Full para TODO el listado, ni se llama al detector de
      // DOM — la URL nunca puede contradecir su propio filtro.
      const esFull = filtroFullActivo || detectarFullEnTarjeta(tarjeta);
      if (esFull) tarjetasConFull += 1;

      const linkEl = U.primerElemento(["a.poly-component__title"], tarjeta);
      const href = linkEl ? linkEl.getAttribute("href") : null;
      const idInfo = clasificarLinkListadoMl(href);
      if (!idInfo) return; // sin forma de identificar la publicación, se descarta — nunca se inventa

      const esAnuncio = Boolean(U.primerElemento(['a.poly-component__ads-promotions', 'a[aria-label="Promocionado"]'], tarjeta));
      if (esAnuncio) return; // mismo criterio que las otras 5 plataformas: nunca mezcla pago con orgánico (esFull de este Ad YA se contó arriba, en tarjetasConFull — nunca entra a productos)

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
    return { productos, estadisticasFull: { totalTarjetas: tarjetas.length, conFull: tarjetasConFull } };
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
    contarTarjetasListado,
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
    // Issue #233 — puro (string -> objeto, sin DOM), nunca necesitó
    // estar afuera de leerListado salvo que hasta esta tarea nadie la
    // había probado con vitest — justo la función con el bug real del
    // smoke (descartaba toda tarjeta no-MCO). Se suma al export para
    // poder probarla de verdad, mismo criterio que el resto de este
    // archivo.
    clasificarLinkListadoMl,
    // Issue #241 — puro (string de HTML -> boolean, sin DOM) a
    // propósito: es la cuarta vuelta del bug de Full, y esta vez se
    // puede probar con un fixture real sin depender de un selector CSS
    // que solo se confirma (o no) en vivo.
    detectarFullEnHtmlTarjeta,
    // Issue #245 — puro (string de HTML de la ficha, o del bloque de
    // envío ya resuelto -> boolean), calco exacto del selector real de
    // Zilonix OS para Full, probado con fixture real.
    detectarFullEnHtmlFicha,
    // Issue #248 (vuelta 2) — puro (string de URL -> boolean), señal
    // fuerte del filtro Full de Mercado Libre, probado con casos
    // reales de la URL.
    filtroFullActivoEnUrl,
    // Issue #251 — puro (string de texto -> {valor, aproximado}),
    // probado con el texto real del selector de cantidad de la ficha.
    leerInventarioMaximoDeTexto,
    // Issue #251 (revisión de Pablo + corrección de Mateo) — puro,
    // probado con los fixtures reales de available_quantity (ver
    // comentario completo junto a la función).
    elegirInventarioPrincipal,
    leerPublicacionesTienda,
    construirPublicacionesTienda,
  };

  // Igual que extension/seguridad.js: en el navegador real no existe
  // `module` — este bloque solo corre cuando vitest hace require()/
  // import() del archivo, sin navegador.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixLectorActivo = {
      sitio: "Mercado Libre Colombia",
      tipoDePagina,
      leerProducto,
      leerListado,
      leerTienda,
      leerResenas,
      // Issue #248 (vuelta 5) — ver el comentario completo arriba de
      // `contarTarjetasListado`. Opcional a propósito: las otras 5
      // plataformas no la exponen, `esperarListadoEstable`
      // (content.js) cae a `productos.length` si no está.
      contarTarjetasListado,
    };
  }
})();
