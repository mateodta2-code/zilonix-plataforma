// Issue #174 — lector de AliExpress. Honestidad real: este sitio
// genera buena parte de sus clases CSS en el build (cambian seguido),
// así que acá se prioriza og:title/meta de producto (más estables)
// sobre selectores visuales — y varios candidatos por campo, como en
// los demás lectores. Si un campo no aparece, queda null ("no
// disponible"), nunca un valor adivinado.
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;

  function tipoDePagina(url) {
    if (/\/item\/[\d.]+\.html/i.test(url)) return "producto";
    if (/\/wholesale|[?&]SearchText=|\/w\/wholesale/i.test(url)) return "listado";
    return null;
  }

  function leerProducto(doc) {
    const textoVendidos = U.textoPorPatron(/\d[\d.,]*\+?\s*(sold|vendidos)/i, doc);
    return {
      titulo: U.metaContenido(["og:title"]) || U.textoDe(["h1", "[data-pl='product-title']", ".product-title-text"], doc),
      precio: U.numeroDesdeTexto(
        U.metaContenido(["product:price:amount"]) ||
          U.textoDe([".product-price-value", ".uniform-banner-box-price", "[class*='Price_c']"], doc)
      ),
      moneda: null,
      precioAnterior: U.numeroDesdeTexto(U.textoDe(["[class*='Price_del']", "del"], doc)),
      descuentoPorcentaje: U.enteroDesdeTexto(U.textoDe(["[class*='discount']"], doc)),
      vendidos: U.enteroDesdeTexto(textoVendidos),
      vendedor: U.textoDe(["[data-pl='store-name']", ".shop-name", "a[href*='/store/']"], doc),
      calificacion: U.calificacionDesdeTexto(U.textoDe(["[class*='Rating']", ".overview-rating-average"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe(["[class*='ReviewRating'] [class*='count']", ".product-reviewer-reviews"], doc)),
    };
  }

  // Issue #225 — "parity Zilonix OS": fuente real confirmada en vivo
  // (Cowork, zilonix-os-web, chrome-extension-busqueda/scraper-aliexpress-search.js,
  // "auriculares bluetooth"/"raquetas de badminton") — NO adivinada:
  // window._dida_config_._init_data_.data.data.root.fields.mods.itemList.content
  // — 60 productos, SIEMPRE completos (el DOM solo renderiza 18-24 de
  // 60 sin scroll, por eso se lee del JSON directo, nunca del DOM).
  // El JSON-LD de esta página existe pero viene con comillas mal
  // escapadas y sin precio/ventas — no se usa.
  //
  // Bug real que esto evita (confirmado por Cowork): la asignación
  // real tiene DOS sentencias en el mismo script
  // ("window._dida_config_={...chico...}; window._dida_config_._init_data_={...grande...}")
  // — buscar solo "_dida_config_" agarra la sentencia CHICA (parsea
  // sin error, pero vacía de lo que hace falta). El marcador tiene que
  // ser "_dida_config_._init_data_" específico. Además el valor real
  // es "{ data: {...} }" con la clave "data" SIN comillas (literal de
  // JS, no JSON puro) — hay que cortar el objeto de ADENTRO de "data:".
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
    return null;
  }

  // "1.000+ vendidos"/"213 vendidos" -> el punto SÍ es separador de
  // miles en ESTE campo puntual (formato distinto del precio, abajo —
  // cada campo de AliExpress usa el suyo, confirmado por Cowork).
  function parseVentasAliExpress(texto) {
    if (!texto) return null;
    const m = String(texto).match(/([\d.,]+)\+?\s*vendid/i);
    if (!m) return null;
    const limpio = m[1].replace(/\./g, "").replace(",", ".");
    const n = Math.round(parseFloat(limpio));
    return Number.isFinite(n) ? n : null;
  }

  function leerDidaConfig(doc) {
    const marcador = "_dida_config_._init_data_";
    const scripts = doc.querySelectorAll("script");
    for (const s of scripts) {
      const texto = s.textContent || "";
      const idxMarcador = texto.indexOf(marcador);
      if (idxMarcador === -1) continue;
      const idxIgual = texto.indexOf("=", idxMarcador + marcador.length);
      if (idxIgual === -1) continue;
      const idxLlaveExterna = texto.indexOf("{", idxIgual);
      if (idxLlaveExterna === -1) continue;
      const prefijo = texto.slice(idxLlaveExterna, idxLlaveExterna + 30).match(/^\{\s*data\s*:\s*/);
      if (!prefijo) continue;
      const idxLlaveInterna = idxLlaveExterna + prefijo[0].length;
      if (texto[idxLlaveInterna] !== "{") continue;
      const jsonTexto = extraerObjetoJsonDesde(texto, idxLlaveInterna);
      if (!jsonTexto) continue;
      try {
        const data = JSON.parse(jsonTexto);
        // "data" ya es el contenido de "data:" (ver nota arriba) —
        // ahí sigue habiendo OTRA clave "data" propia antes de "root"
        // (confirmado por Cowork) — nunca data.root directo.
        if (!data || !data.data || !data.data.root) continue;
        return data;
      } catch {
        continue;
      }
    }
    return null;
  }

  function leerListado(doc) {
    const config = leerDidaConfig(doc);
    const lista = (config && config.data && config.data.root && config.data.root.fields && config.data.root.fields.mods && config.data.root.fields.mods.itemList && config.data.root.fields.mods.itemList.content) || [];
    // productType "ad" = patrocinado — se excluye, mismo criterio que las demás plataformas.
    const productos = lista
      .filter((it) => it && it.productType !== "ad")
      .map((it) => {
        const productId = it.productId ? String(it.productId) : null;
        if (!productId) return null;
        const precio = typeof (it.prices && it.prices.salePrice && it.prices.salePrice.minPrice) === "number"
          ? it.prices.salePrice.minPrice
          : U.numeroDesdeTexto(it.prices && it.prices.salePrice && it.prices.salePrice.formattedPrice);
        const vendidos = parseVentasAliExpress((it.trade && it.trade.tradeDesc) || "");
        return {
          titulo: (it.title && it.title.displayTitle) || null,
          precio,
          vendidos,
          link: `https://es.aliexpress.com/item/${productId}.html`,
        };
      })
      .filter(Boolean);
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "AliExpress", tipoDePagina, leerProducto, leerListado };
})();
