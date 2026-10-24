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

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("[class*='SearchProductFeed'] a, [class*='product-card'], a[href*='/item/']");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["[class*='title']", "h1", "h3"], tarjeta) || tarjeta.getAttribute("title");
      const precio = U.numeroDesdeTexto(U.textoDe(["[class*='price']"], tarjeta));
      const textoVendidos = tarjeta.textContent?.match(/\d[\d.,]*\+?\s*(sold|vendidos)/i)?.[0] || null;
      const link = tarjeta.tagName === "A" ? tarjeta.getAttribute("href") : U.atributoDe(["a"], "href", tarjeta);
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos: U.enteroDesdeTexto(textoVendidos), link });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "AliExpress", tipoDePagina, leerProducto, leerListado };
})();
