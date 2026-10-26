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

  // Issue #225 — "parity Zilonix OS": estructura real confirmada en
  // vivo (Cowork, zilonix-os-web, chrome-extension-busqueda/scraper-temu-search.js,
  // temu.com/co, "auriculares bluetooth"/"organizador de gorras") — NO
  // adivinada. Las clases CSS de Temu están hasheadas/ofuscadas y
  // cambian — nunca se usan. Dos fuentes reales en su lugar:
  //   1) JSON-LD (script[type="application/ld+json"]) — url, image,
  //      name, offers.price, aggregateRating. Siempre presente.
  //   2) window.rawData.store.goodsList[i].data — el más completo
  //      (vendidos, precio tachado), vive en un <script> inline
  //      ("window.rawData=...") — se lee como TEXTO, nunca ejecutando
  //      la página.
  // Se cruzan por goodsId (de la URL: "...-g-{id}.html"). Sin rawData,
  // igual queda el JSON-LD (precio, título) — se pierde solo ventas.
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
    return null; // nunca cerró — el script sigue con más código después del objeto (confirmado por Cowork), cortar "hasta el final" rompe el JSON
  }

  // "47K+"/"47K+ ventas"/"22K+" -> 47000 (piso). Temu NUNCA dice sobre
  // qué período es esta cifra — puede ser acumulado histórico, nunca
  // se asume mensual (se etiqueta del lado del panel, clasificarSenalVentas).
  function parseVentasTemu(texto) {
    if (!texto) return null;
    const m = String(texto).match(/([\d.,]+)\s*(K|M)?\+?/i);
    if (!m) return null;
    const base = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(base)) return null;
    if (/M/i.test(m[2] || "")) return Math.round(base * 1000000);
    if (/K/i.test(m[2] || "")) return Math.round(base * 1000);
    return Math.round(base);
  }

  function idTemuDesdeUrl(url) {
    const m = String(url || "").match(/-g-(\d+)\.html/);
    return m ? m[1] : null;
  }

  function leerJsonLdTemu(doc) {
    const items = [];
    doc.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
      try {
        const data = JSON.parse(s.textContent || "");
        const candidatos = Array.isArray(data) ? data : Array.isArray(data.itemListElement) ? data.itemListElement.map((x) => x.item || x) : [data];
        candidatos.forEach((c) => {
          if (c && c.url && c.offers) items.push(c);
        });
      } catch {
        // bloque no parseable — se ignora, queda lo que sí sirvió
      }
    });
    return items;
  }

  function leerRawDataTemu(doc) {
    const marcador = "window.rawData=";
    const scripts = doc.querySelectorAll("script");
    for (const s of scripts) {
      const texto = s.textContent || "";
      const idxMarcador = texto.indexOf(marcador);
      if (idxMarcador === -1) continue;
      const idxLlave = texto.indexOf("{", idxMarcador + marcador.length);
      if (idxLlave === -1) continue;
      const jsonTexto = extraerObjetoJsonDesde(texto, idxLlave);
      if (!jsonTexto) continue;
      try {
        return JSON.parse(jsonTexto);
      } catch {
        // sigue probando otros scripts
      }
    }
    return null;
  }

  function leerListado(doc) {
    const itemsJsonLd = leerJsonLdTemu(doc);
    const rawData = leerRawDataTemu(doc);
    const porId = new Map();
    if (rawData && rawData.store && rawData.store.goodsList) {
      for (const g of rawData.store.goodsList) {
        const d = g && g.data;
        if (d && d.goodsId) porId.set(String(d.goodsId), d);
      }
    }

    const productos = itemsJsonLd
      .map((it) => {
        const goodsId = idTemuDesdeUrl(it.url);
        if (!goodsId) return null;
        const extra = porId.get(goodsId);
        const precio = U.numeroDesdeTexto(it.offers && it.offers.price != null ? String(it.offers.price) : null) ?? (extra && extra.priceInfo && extra.priceInfo.price != null ? Math.round(extra.priceInfo.price / 100) : null);
        const vendidos = parseVentasTemu((extra && (extra.salesNum || extra.salesTip)) || "");
        // Issue #227 — foto/estrellas confirmados en el mismo scraper
        // real (zilonix-os-web, scraper-temu-search.js) que ya
        // confirmó precio/ventas — para fotos ampliables y el sort
        // "Más calificación".
        const foto = it.image || (extra && extra.image && extra.image.url) || (extra && extra.thumbUrl) || null;
        const calificacionCruda = (it.aggregateRating && it.aggregateRating.ratingValue) ?? (extra && extra.comment && extra.comment.goodsScore);
        const calificacion = calificacionCruda != null ? parseFloat(calificacionCruda) : null;
        return { titulo: it.name || (extra && extra.title) || null, precio, vendidos, foto, calificacion: Number.isFinite(calificacion) ? calificacion : null, link: it.url || null };
      })
      .filter(Boolean);
    return { productos };
  }

  window.ZilonixLectorActivo = { sitio: "Temu", tipoDePagina, leerProducto, leerListado };
})();
