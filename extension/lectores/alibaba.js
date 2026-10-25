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

  // Issue #225 — "parity Zilonix OS": fuente real confirmada en vivo
  // (Cowork, zilonix-os-web, chrome-extension-busqueda/scraper-alibaba-search.js,
  // "hat organizer") — NO adivinada:
  // window.__page__data_sse10._offer_list.offerResultData.offers
  //
  // Bug real que esto evita (confirmado por Cowork): hay ~15 scripts
  // que mencionan "__page__data_sse10" (uno chico que solo inicializa
  // "window.__page__data_sse10={};" viene ANTES del grande) — el
  // marcador tiene que ser "_offer_list" específico, nunca el genérico.
  // Además la asignación real es "...__page__data_sse10._offer_list = {...}"
  // — el objeto que se extrae YA ES el contenido de "_offer_list" en sí
  // mismo (se "gastó" en el nombre de la variable) — la ruta correcta
  // es data.offerResultData.offers, directo, SIN otro "._offer_list"
  // en el medio.
  //
  // Diferencia real con las otras 4 plataformas: Alibaba puede
  // interceptar la búsqueda con un CAPTCHA (confirmado en vivo) — esto
  // NUNCA se resuelve solo, se detecta (document.title exacto) y se
  // avisa (ver extension/content.js/background.js), nunca "0 resultados"
  // sin explicación.
  function hayCaptchaAlibaba(doc) {
    return doc.title === "Captcha Interception";
  }

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

  function parseVentasAlibaba(texto) {
    if (!texto) return null;
    const m = String(texto).match(/([\d.,]+)\s*vendid/i);
    if (!m) return null;
    const limpio = m[1].replace(/\./g, "").replace(",", ".");
    const n = Math.round(parseFloat(limpio));
    return Number.isFinite(n) ? n : null;
  }

  function leerOfferList(doc) {
    const marcador = "__page__data_sse10._offer_list";
    const scripts = doc.querySelectorAll("script");
    for (const s of scripts) {
      const texto = s.textContent || "";
      const idxMarcador = texto.indexOf(marcador);
      if (idxMarcador === -1) continue;
      const idxIgual = texto.indexOf("=", idxMarcador + marcador.length);
      if (idxIgual === -1) continue;
      const idxLlave = texto.indexOf("{", idxIgual);
      if (idxLlave === -1) continue;
      const jsonTexto = extraerObjetoJsonDesde(texto, idxLlave);
      if (!jsonTexto) continue;
      try {
        const data = JSON.parse(jsonTexto);
        // Defensa extra (aprendida de este mismo bug): un parseo
        // exitoso no garantiza que sea el objeto correcto — se exige
        // que tenga offerResultData antes de darlo por bueno.
        if (!data || !data.offerResultData) continue;
        return data;
      } catch {
        continue;
      }
    }
    return null;
  }

  function leerListado(doc) {
    if (hayCaptchaAlibaba(doc)) return { productos: [], captcha: true };

    const data = leerOfferList(doc);
    const ofertas = (data && data.offerResultData && data.offerResultData.offers) || [];
    // isShowAd filtra la mayoría de los anuncios (confirmado: no es
    // perfecto, Cowork vio un caso con etiqueta "Ad" en pantalla y
    // isShowAd=false — es la mejor señal disponible, nunca un filtro
    // más agresivo sin evidencia).
    const productos = ofertas
      .filter((o) => o && !o.isShowAd)
      .map((o) => {
        const productId = o.productId ? String(o.productId) : null;
        if (!productId) return null;
        // Alibaba es mayorista: o.price suele venir como rango
        // ("COP 11.001- 11.668" por cantidad) — se toma el primer
        // número (el mínimo) para el campo `precio` (número único de
        // este pipeline), nunca un promedio inventado. El rango
        // completo no se pierde del todo: o.price queda disponible
        // si en el futuro hace falta mostrarlo tal cual.
        const precioTexto = String(o.price || "");
        const precioMatch = precioTexto.match(/[\d][\d.,]*/);
        const precio = precioMatch ? U.numeroDesdeTexto(precioMatch[0]) : null;
        const linkRaw = o.productUrl || "";
        const link = linkRaw ? (linkRaw.indexOf("//") === 0 ? `https:${linkRaw}` : linkRaw) : `https://www.alibaba.com/product-detail/x_${productId}.html`;
        return { titulo: o.title || null, precio, vendidos: parseVentasAlibaba(o.soldOrder || ""), link };
      })
      .filter(Boolean);
    return { productos, captcha: false };
  }

  window.ZilonixLectorActivo = { sitio: "Alibaba", tipoDePagina, leerProducto, leerListado };
})();
