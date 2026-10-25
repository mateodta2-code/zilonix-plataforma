// Issue #174 — lector de Shein. Mismo criterio honesto que
// temu.js/aliexpress.js: clases generadas por build, se prioriza
// meta/og y texto por patrón. Campo sin dato real -> null.
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;

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

  function leerListado(doc) {
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
      let link = href;
      try {
        link = href ? new URL(href, doc.location ? doc.location.origin : location.origin).href : null;
      } catch {
        link = href;
      }
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos, link });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Shein", tipoDePagina, leerProducto, leerListado };
})();
