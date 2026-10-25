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

  // Issue #225 — "parity Zilonix OS": estructura real confirmada en
  // vivo (Cowork, zilonix-os-web, chrome-extension-busqueda/scraper-amazon-search.js,
  // "bluetooth headphones", 24 tarjetas / 8 patrocinadas) — NO adivinada:
  //   div[data-component-type="s-search-result"][data-asin]  (ignorar data-asin vacío)
  //     [data-cy="title-recipe"] h2                            (título)
  //     [data-cy="price-recipe"] .a-price .a-offscreen          ("US$13.26")
  //     [data-cy="reviews-block"] span.a-size-base.a-color-secondary  ("10 K+ comprados
  //                                                                     el mes pasado")
  // Link se arma con el ASIN (más confiable que leer el href real,
  // que en patrocinados va por /sspa/…). "comprados el mes pasado" es
  // el ÚNICO caso real confirmado donde un número de ventas SÍ es una
  // tasa mensual de verdad (nunca un acumulado histórico) — se etiqueta
  // así del lado del panel (lib/ml/importacionListadoCliente.ts,
  // clasificarSenalVentas), nunca acá.
  //
  // A propósito NO se porta el scroll-para-cargar-más de OS (bug real
  // que ahí hacía falta por el render virtual de Amazon) — esta
  // extensión reintenta sola cada ~900ms (reescanearConRetardo,
  // content.js) a medida que la página carga; solo se pierden las
  // tarjetas que necesitan scroll manual, documentado en extension/LEEME.md.
  function parsePrecioUSD(texto) {
    if (!texto) return null;
    const limpio = String(texto).replace(/[^\d.,]/g, "").replace(/,/g, "");
    const n = parseFloat(limpio);
    return Number.isFinite(n) ? n : null;
  }

  // "10 K+ comprados el mes pasado" -> 10000 · "200+ comprados…" -> 200.
  // Es un PISO (la cifra real de Amazon es un rango) — mejor aproximación
  // real disponible, nunca inventada.
  function parseCompradosMes(texto) {
    if (!texto) return null;
    const m = String(texto).match(/([\d.,]+)\s*(K)?\+/i);
    if (!m) return null;
    const base = parseInt(m[1].replace(/[.,]/g, ""), 10);
    if (!Number.isFinite(base)) return null;
    return m[2] ? base * 1000 : base;
  }

  function leerListado(doc) {
    const tarjetas = doc.querySelectorAll('div[data-component-type="s-search-result"][data-asin]');
    const productos = [];
    tarjetas.forEach((div) => {
      const asin = div.getAttribute("data-asin");
      if (!asin) return;
      const tituloEl = U.primerElemento(['[data-cy="title-recipe"] h2'], div);
      const titulo = (tituloEl && tituloEl.textContent ? tituloEl.textContent.trim() : "") || null;
      const precio = parsePrecioUSD(U.textoDe(['[data-cy="price-recipe"] .a-price .a-offscreen'], div));
      const vendidos = parseCompradosMes(U.textoDe(['[data-cy="reviews-block"] span.a-size-base.a-color-secondary'], div));
      if (titulo || precio != null) productos.push({ titulo, precio, vendidos, link: `https://www.amazon.com/dp/${asin}` });
    });
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Amazon", tipoDePagina, leerProducto, leerListado };
})();
