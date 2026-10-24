// Issue #174 — lector de Mercado Libre Colombia. Los selectores de
// abajo son los reales de las plantillas "ui-pdp-*" (producto) y
// "ui-search-*" (listado/búsqueda) al momento de escribir esto —
// Mercado Libre las cambia de tanto en tanto, por eso cada campo
// prueba VARIAS alternativas (la más nueva primero) antes de rendirse
// y mostrar "no disponible". Si algún día ninguna funciona, se
// agregan más strings a la lista — nunca hace falta tocar content.js.
(function () {
  "use strict";
  const U = window.ZilonixUtilidades;

  function tipoDePagina(url) {
    if (/\/(p\/)?MCO-?\d+/i.test(url) || /articulo\.mercadolibre/i.test(url)) return "producto";
    if (/listado\.mercadolibre|\/search|[?&]q=/i.test(url)) return "listado";
    return null;
  }

  function leerProducto(doc) {
    const bloqueEnvio = U.primerElemento([".ui-pdp-shipping", ".ui-pdp-container__col--shipping"], doc);
    const textoEnvio = bloqueEnvio ? bloqueEnvio.textContent || "" : "";
    const textoSubtitulo = U.textoDe([".ui-pdp-subtitle", "span.ui-pdp-subtitle"], doc) || "";

    // "Catálogo" en ML = la publicación trae varias ofertas de
    // distintos vendedores para el mismo producto — el marcador real
    // es el bloque "Mejor opción de compra"/"Otras opciones de compra".
    const tieneBuybox = Boolean(U.primerElemento([".ui-pdp-buybox__highlight", ".ui-pdp-seller__header"], doc));

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
      vendidos: U.enteroDesdeTexto((textoSubtitulo.match(/[\d.,]+\s*vendid/i) || [])[0] || null),
      vendedor: U.textoDe([".ui-pdp-seller__header__title", ".ui-pdp-seller__link-trigger-button", "a.ui-pdp-seller__link-trigger-button"], doc),
      calificacion: U.calificacionDesdeTexto(U.textoDe([".ui-pdp-review__rating", ".ui-review-capability__rating__average"], doc)),
      numeroOpiniones: U.enteroDesdeTexto(U.textoDe([".ui-pdp-review__amount", ".ui-review-capability__rating__amount"], doc)),
      esCatalogo: tieneBuybox,
      esFull: /\bfull\b/i.test(textoEnvio),
      envioGratis: /envío\s*gratis|envio\s*gratis/i.test(textoEnvio),
    };
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll("li.ui-search-layout__item, div.ui-search-result, li.ui-search-layout_grid-item");
    const productos = [];
    tarjetas.forEach((tarjeta) => {
      const titulo = U.textoDe(["h2.ui-search-item__title", ".ui-search-item__title", "h3.poly-component__title"], tarjeta);
      const precio = U.numeroDesdeTexto(
        U.textoDe([".ui-search-price__second-line .andes-money-amount__fraction", ".andes-money-amount__fraction"], tarjeta)
      );
      const textoTarjeta = tarjeta.textContent || "";
      const vendidos = U.enteroDesdeTexto((textoTarjeta.match(/[\d.,]+\s*vendid/i) || [])[0] || null);
      const link = U.atributoDe(["a.ui-search-link", "a.ui-search-item__group__element", "a.poly-component__title"], "href", tarjeta);
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos, link });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Mercado Libre Colombia", tipoDePagina, leerProducto, leerListado };
})();
