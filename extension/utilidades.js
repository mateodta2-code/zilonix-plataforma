// Issue #174 — funciones chicas y genéricas que usan los 6 lectores
// (extension/lectores/*.js) para no repetir la misma lógica de
// "probar varios selectores hasta que uno funcione" y "convertir un
// precio en texto a número real" en cada sitio. Nada de esto sabe de
// un sitio en particular — eso vive en cada lector, en una lista de
// selectores fácil de encontrar y de actualizar cuando el sitio
// cambie su HTML.
(function () {
  "use strict";

  function primerElemento(selectores, raiz) {
    const base = raiz || document;
    for (const selector of selectores) {
      try {
        const elemento = base.querySelector(selector);
        if (elemento) return elemento;
      } catch {
        // Selector inválido para este navegador/versión — se prueba
        // el siguiente, nunca se rompe la lectura completa por esto.
      }
    }
    return null;
  }

  function textoDe(selectores, raiz) {
    const elemento = primerElemento(selectores, raiz);
    const texto = elemento ? elemento.textContent?.trim() : null;
    return texto ? texto : null;
  }

  function atributoDe(selectores, atributo, raiz) {
    const elemento = primerElemento(selectores, raiz);
    const valor = elemento ? elemento.getAttribute(atributo) : null;
    return valor ? valor.trim() : null;
  }

  // "$ 1.234.567", "COP 50.000", "US$12.99", "1.234,56" -> número real.
  // Nunca inventa un valor: si no hay ningún dígito, devuelve null.
  function numeroDesdeTexto(texto) {
    if (!texto) return null;
    const limpio = texto.replace(/[^\d.,]/g, "");
    if (!limpio || !/\d/.test(limpio)) return null;

    const posComa = limpio.lastIndexOf(",");
    const posPunto = limpio.lastIndexOf(".");
    let normalizado;
    if (posComa > -1 && posPunto > -1) {
      // El separador que aparece último es el decimal real.
      normalizado = posComa > posPunto ? limpio.replace(/\./g, "").replace(",", ".") : limpio.replace(/,/g, "");
    } else if (posComa > -1) {
      // Solo coma: decimal real solo si quedan 1-2 dígitos después de
      // la ÚLTIMA coma ("12,99") — con 3+ ("50,000" o "1,234,567") es
      // separador de miles, se borra entera.
      const decimales = limpio.length - posComa - 1;
      normalizado = decimales > 0 && decimales <= 2 ? limpio.replace(",", ".") : limpio.replace(/,/g, "");
    } else if (posPunto > -1) {
      // Mismo criterio con el punto — bug real: "$ 1.234.567" y
      // "COP 50.000" (formato colombiano de miles con punto, sin
      // ninguna coma) daban 1234.567 y 50 en vez del precio real,
      // porque este caso nunca borraba el punto de miles.
      const decimales = limpio.length - posPunto - 1;
      normalizado = decimales > 0 && decimales <= 2 ? limpio : limpio.replace(/\./g, "");
    } else {
      normalizado = limpio;
    }
    const numero = Number(normalizado);
    return Number.isFinite(numero) ? numero : null;
  }

  // Para cantidades enteras (vendidos, número de opiniones) — ignora
  // decimales y separadores de miles, nunca asume "mil"/"k" como
  // multiplicador (eso sería inventar una cifra que el sitio no dio
  // como número exacto).
  function enteroDesdeTexto(texto) {
    if (!texto) return null;
    const match = texto.replace(/[.,](?=\d{3}\b)/g, "").match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  // Calificación tipo "4.8 de 5" / "4,8 out of 5 stars" -> 4.8. Toma
  // el primer número decimal del texto, nunca redondea ni inventa.
  function calificacionDesdeTexto(texto) {
    if (!texto) return null;
    const match = texto.match(/\d+([.,]\d+)?/);
    if (!match) return null;
    const numero = Number(match[0].replace(",", "."));
    return Number.isFinite(numero) ? numero : null;
  }

  // Busca el primer nodo de texto visible dentro de `raiz` cuyo
  // contenido haga match con `regex` — para datos sin selector
  // estable (ej. "+500 vendidos" mezclado en un bloque de texto
  // libre, muy común en Mercado Libre y Amazon).
  function textoPorPatron(regex, raiz) {
    const base = raiz || document.body;
    const walker = document.createTreeWalker(base, NodeFilter.SHOW_TEXT);
    let nodo;
    while ((nodo = walker.nextNode())) {
      const texto = nodo.textContent;
      if (texto && regex.test(texto)) return texto.trim();
    }
    return null;
  }

  // Varios sitios con clases CSS generadas/ofuscadas (Temu, Shein,
  // AliExpress, Alibaba) sí mantienen metadatos <meta property="og:..">
  // u otros estables para redes sociales/buscadores — más confiables
  // ahí que adivinar una clase que cambia con cada build.
  function metaContenido(propiedades) {
    for (const propiedad of propiedades) {
      const elemento = document.querySelector(`meta[property="${propiedad}"], meta[name="${propiedad}"], meta[itemprop="${propiedad}"]`);
      const valor = elemento ? elemento.getAttribute("content") : null;
      if (valor) return valor.trim();
    }
    return null;
  }

  window.ZilonixUtilidades = {
    primerElemento,
    textoDe,
    atributoDe,
    numeroDesdeTexto,
    enteroDesdeTexto,
    calificacionDesdeTexto,
    textoPorPatron,
    metaContenido,
  };
})();
