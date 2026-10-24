// Issue #174 — lector de Temu. Mismo criterio honesto que
// aliexpress.js: clases CSS generadas por build (muy inestables), así
// que se prioriza meta/og y texto por patrón sobre selectores
// visuales. Campo sin dato real -> null ("no disponible").
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;

  function tipoDePagina(url) {
    if (/-g-\d+\.html|\/goods/i.test(url)) return "producto";
    if (/[?&]search_key=|\/search_result|\/channel\//i.test(url)) return "listado";
    return null;
  }

  function leerProducto(doc) {
    const textoVendidos = U.textoPorPatron(/\d[\d.,]*\+?\s*(sold|vendidos)/i, doc);
    return {
      titulo: U.metaContenido(["og:title"]) || U.textoDe(["h1"], doc),
      precio: U.numeroDesdeTexto(U.metaContenido(["og:price:amount", "product:price:amount"]) || U.textoDe(["[class*='price'] [class*='amount']", "[class*='Price']"], doc)),
      moneda: null,
      precioAnterior: U.numeroDesdeTexto(U.textoDe(["[class*='originalPrice']", "del"], doc)),
      descuentoPorcentaje: U.enteroDesdeTexto(U.textoDe(["[class*='discount']", "[class*='Off']"], doc)),
      vendidos: U.enteroDesdeTexto(textoVendidos),
      vendedor: U.textoDe(["[class*='storeName']", "[class*='mall-name']"], doc),
      calificacion: U.calificacionDesdeTexto(U.textoDe(["[class*='rating'] [class*='score']", "[class*='Rating']"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe(["[class*='reviewCount']", "[class*='review-num']"], doc)),
    };
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("a[href*='-g-'], [class*='goods-item'], [class*='GoodsCard']");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["[class*='title']"], tarjeta) || tarjeta.getAttribute("title");
      const precio = U.numeroDesdeTexto(U.textoDe(["[class*='price']"], tarjeta));
      const textoVendidos = tarjeta.textContent?.match(/\d[\d.,]*\+?\s*(sold|vendidos)/i)?.[0] || null;
      const link = tarjeta.tagName === "A" ? tarjeta.getAttribute("href") : U.atributoDe(["a"], "href", tarjeta);
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos: U.enteroDesdeTexto(textoVendidos), link });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Temu", tipoDePagina, leerProducto, leerListado };
})();
