// Issue #174 — lector de Amazon. Mismo criterio que mercadolibre.js:
// varios selectores por campo (Amazon cambia de plantilla seguido),
// y si ninguno funciona el campo queda en null ("no disponible" en el
// panel) — nunca se inventa un valor.
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;

  function tipoDePagina(url) {
    if (/\/(dp|gp\/product)\//i.test(url)) return "producto";
    if (/\/s[?/]|[?&]k=/i.test(url)) return "listado";
    return null;
  }

  function leerProducto(doc) {
    const textoCalificacion = U.atributoDe(["#acrPopover"], "title", doc) || U.textoDe(["span.a-icon-alt"], doc);
    // Amazon no siempre muestra "vendidos" — solo en algunos productos
    // trae "X+ bought in past month" cerca del título/precio.
    const textoVendidos = U.textoPorPatron(/bought in (the )?past month/i, doc);

    return {
      titulo: U.textoDe(["#productTitle"], doc),
      precio: U.numeroDesdeTexto(
        U.textoDe(
          [
            "#corePrice_feature_div .a-price .a-offscreen",
            "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
            "#priceblock_ourprice",
            "#priceblock_dealprice",
            ".a-price .a-offscreen",
          ],
          doc
        )
      ),
      moneda: null, // Amazon ya incluye el símbolo adentro del precio (US$, MX$...), no hace falta aparte.
      precioAnterior: U.numeroDesdeTexto(
        U.textoDe([".basisPrice .a-price.a-text-price .a-offscreen", "span[data-a-strike='true'] .a-offscreen"], doc)
      ),
      descuentoPorcentaje: U.enteroDesdeTexto(U.textoDe([".savingsPercentage"], doc)),
      vendidos: U.enteroDesdeTexto(textoVendidos),
      vendedor: U.textoDe(["#sellerProfileTriggerId", "#bylineInfo"], doc),
      calificacion: U.calificacionDesdeTexto(textoCalificacion),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe(["#acrCustomerReviewText"], doc)),
    };
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("div[data-component-type='s-search-result']");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["h2 a span", "h2 .a-text-normal", "h2"], tarjeta);
      const precio = U.numeroDesdeTexto(U.textoDe([".a-price .a-offscreen"], tarjeta));
      const textoVendidos = U.textoPorPatron(/bought in (the )?past month/i, tarjeta);
      const link = U.atributoDe(["h2 a"], "href", tarjeta);
      if (titulo || precio != null) {
        productos.push({ titulo, precio, vendidos: U.enteroDesdeTexto(textoVendidos), link });
      }
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Amazon", tipoDePagina, leerProducto, leerListado };
})();
