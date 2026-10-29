// Issue #174 — lector de Shein. Mismo criterio honesto que
// temu.js/aliexpress.js: clases generadas por build, se prioriza
// meta/og y texto por patrón. Campo sin dato real -> null.
(function () {
  "use strict";
  // Issue #44 (anexo "Importar video a Clip") — mismo patrón dual que
  // lectores/mercadolibre.js: en Node (vitest) no existe `window`, se
  // usa utilidades.js/video-comun.js directo con require(); en el
  // navegador (content script real) `window` sí existe. Hasta esta
  // tarea `U` nunca tenía este guard porque este archivo no tenía
  // ningún test que lo importara en Node — ahora leerVideoDesdeHtml
  // (abajo) sí, así que hace falta.
  const U = typeof window !== "undefined" ? window.ZilonixUtilidades : require("../utilidades.js");
  const V = typeof window !== "undefined" ? window.ZilonixVideoComun : require("./video-comun.js");

  function tipoDePagina(url) {
    if (/-p-\d+(-cat-\d+)?\.html/i.test(url)) return "producto";
    if (/[?&]search=|\/pdsearch\/|-c-\d+\.html/i.test(url)) return "listado";
    return null;
  }

  function leerProducto(doc) {
    const textoVendidos = U.textoPorPatron(/\d[\d.,]*\+?\s*(sold|vendidos|reviews?)/i, doc);
    return {
      titulo: U.metaContenido(["og:title"]) || U.textoDe(["h1", "[class*='product-intro__head-name']"], doc),
      precio: U.numeroDesdeTexto(U.metaContenido(["product:price:amount"]) || U.textoDe(["[class*='product-intro__head-price']", "[class*='original-price']", "[class*='price']"], doc)),
      moneda: null,
      precioAnterior: U.numeroDesdeTexto(U.textoDe(["[class*='product-intro__head-retail']", "del"], doc)),
      descuentoPorcentaje: U.enteroDesdeTexto(U.textoDe(["[class*='discount']", "[class*='off-percent']"], doc)),
      vendidos: U.enteroDesdeTexto(textoVendidos),
      vendedor: U.textoDe(["[class*='store-name']", "[class*='shop-name']"], doc) || "Shein",
      calificacion: U.calificacionDesdeTexto(U.textoDe(["[class*='product-intro__head-rate']", "[class*='rating']"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe(["[class*='product-intro__head-reviews']", "[class*='review-num']"], doc)),
    };
  }

  // Issue #225 — "parity Zilonix OS": estructura real confirmada en
  // vivo (Cowork, zilonix-os-web, chrome-extension-busqueda/scraper-shein-search.js,
  // shein.com.co, "organizador de gorras"/"raquetas de badminton") —
  // NO adivinada. A diferencia de AliExpress, las tarjetas SÍ están
  // completas en el DOM (sin render virtual):
  //   div.bs-product-card[role=listitem]
  //     a[href*="-p-"]                        (link + id, "...-p-{id}.html")
  //     .bs-product-card__goods-name-text      (título)
  //     .bs-product-card__offscreen            (precio)
  //     .bs-product-card__sales-label          ("1.000+ vendidos")
  function parseVentasShein(texto) {
    if (!texto) return null;
    const m = String(texto).match(/([\d.,]+)\+?\s*vendid/i);
    if (!m) return null;
    const limpio = m[1].replace(/\./g, "").replace(",", ".");
    const n = Math.round(parseFloat(limpio));
    return Number.isFinite(n) ? n : null;
  }

  function idSheinDesdeHref(href) {
    const m = String(href || "").match(/-p-(\d+)\.html/);
    return m ? m[1] : null;
  }

  // Issue #227 — estrellas/reseñas vía JSON-LD (confirmado en el mismo
  // scraper real, zilonix-os-web, scraper-shein-search.js) — cubre
  // solo los primeros ~20 productos, el resto queda sin calificación
  // (nunca inventada), indexado por goods_id (sku).
  function leerJsonLdPorIdShein(doc) {
    const porId = new Map();
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const data = JSON.parse(s.textContent || "");
        const lista = Array.isArray(data && data.itemListElement) ? data.itemListElement.map((x) => x.item || x) : [];
        lista.forEach((p) => {
          const id = p && p.sku != null ? String(p.sku) : null;
          if (id) porId.set(id, p);
        });
      } catch {
        // bloque no parseable — se ignora
      }
    });
    return porId;
  }

  function leerListado(doc) {
    const porIdJsonLd = leerJsonLdPorIdShein(doc);
    const tarjetas = doc.querySelectorAll("div.bs-product-card[role=listitem]");
    const productos = [];
    tarjetas.forEach((card) => {
      const linkEl = U.primerElemento(['a[href*="-p-"]'], card);
      const href = linkEl ? linkEl.getAttribute("href") : null;
      const id = idSheinDesdeHref(href);
      if (!id) return;
      const titulo = U.textoDe([".bs-product-card__goods-name-text"], card);
      const precio = U.numeroDesdeTexto(U.textoDe([".bs-product-card__offscreen"], card));
      const vendidos = parseVentasShein(U.textoDe([".bs-product-card__sales-label"], card));
      // Lazy-load confirmado (mismo bug que Amazon): el src real suele
      // venir vacío, la URL buena está en data-src.
      const imgEl = U.primerElemento(["img"], card);
      const foto = imgEl ? imgEl.getAttribute("data-src") || imgEl.getAttribute("src") : null;
      const extra = porIdJsonLd.get(id);
      const calificacion = extra && extra.aggregateRating && extra.aggregateRating.ratingValue != null ? parseFloat(extra.aggregateRating.ratingValue) : null;
      let link = href;
      try {
        link = href ? new URL(href, doc.location ? doc.location.origin : location.origin).href : null;
      } catch {
        link = href;
      }
      if (titulo || precio != null) {
        productos.push({ titulo, precio, vendidos, foto, calificacion: Number.isFinite(calificacion) ? calificacion : null, link });
      }
    });
    return { productos };
  }

  // Issue #44 (anexo "Importar video a Clip") — ver el comentario
  // completo en extension/lectores/video-comun.js: heurística
  // GENÉRICA compartida por las 7 plataformas, nunca selectores
  // propios de Shein (sin evidencia real confirmada de cómo Shein
  // embebe su video de producto). Pura (string -> objeto), probada con
  // un HTML de ejemplo sin navegador — ver shein.test.ts.
  function leerVideoDesdeHtml(html) {
    return V.extraerUrlsVideoDeHtml(html);
  }

  function leerVideo(doc) {
    const html = doc && doc.documentElement && typeof doc.documentElement.outerHTML === "string" ? doc.documentElement.outerHTML : "";
    return leerVideoDesdeHtml(html);
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { leerVideoDesdeHtml };
  }

  // Issue #44 (anexo) — igual que mercadolibre.js: en Node (vitest,
  // require() de leerVideoDesdeHtml) no existe `window` real.
  if (typeof window !== "undefined") {
    window.ZilonixLectorActivo = { sitio: "Shein", tipoDePagina, leerProducto, leerListado, leerVideo };
  }
})();
