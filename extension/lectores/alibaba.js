// Issue #174 — lector de Alibaba. Alibaba es mayorista: casi nunca
// muestra "vendidos" por producto (queda en null/"no disponible" casi
// siempre, y eso es correcto, no un lector roto) y el precio suele
// venir como rango ("$12.50 - $15.00" por cantidad al por mayor) — se
// toma el primer número del rango, nunca se inventa un promedio.
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;

  function tipoDePagina(url) {
    if (/\/product-detail\//i.test(url)) return "producto";
    if (/\/trade\/search|[?&]SearchText=/i.test(url)) return "listado";
    return null;
  }

  function leerProducto(doc) {
    return {
      titulo: U.metaContenido(["og:title"]) || U.textoDe(["h1", "[class*='module_title']"], doc),
      precio: U.numeroDesdeTexto(U.textoDe(["[class*='price-range']", "[class*='period-price']", "[class*='price']"], doc)),
      moneda: null,
      precioAnterior: null, // Alibaba no muestra "precio anterior" tachado en la ficha mayorista — honesto: siempre null acá.
      descuentoPorcentaje: null,
      vendidos: U.enteroDesdeTexto(U.textoPorPatron(/\d[\d.,]*\+?\s*(sold|orders|vendidos)/i, doc)),
      vendedor: U.textoDe(["[class*='company-name']", "[class*='supplier-name']"], doc),
      calificacion: U.calificacionDesdeTexto(U.textoDe(["[class*='review-score']", "[class*='rating']"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe(["[class*='review-count']"], doc)),
    };
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("[class*='search-card'], a[href*='/product-detail/']");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["[class*='title']"], tarjeta) || tarjeta.getAttribute("title");
      const precio = U.numeroDesdeTexto(U.textoDe(["[class*='price']"], tarjeta));
      const link = tarjeta.tagName === "A" ? tarjeta.getAttribute("href") : U.atributoDe(["a"], "href", tarjeta);
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos: null, link });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Alibaba", tipoDePagina, leerProducto, leerListado };
})();
