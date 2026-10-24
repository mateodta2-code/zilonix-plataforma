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

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("[class*='product-card'], [class*='goods-item'], a[href*='-p-']");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["[class*='goods-title']", "[class*='name']"], tarjeta) || tarjeta.getAttribute("title");
      const precio = U.numeroDesdeTexto(U.textoDe(["[class*='price']"], tarjeta));
      const textoVendidos = tarjeta.textContent?.match(/\d[\d.,]*\+?\s*(sold|vendidos)/i)?.[0] || null;
      const link = tarjeta.tagName === "A" ? tarjeta.getAttribute("href") : U.atributoDe(["a"], "href", tarjeta);
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos: U.enteroDesdeTexto(textoVendidos), link });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Shein", tipoDePagina, leerProducto, leerListado };
})();
