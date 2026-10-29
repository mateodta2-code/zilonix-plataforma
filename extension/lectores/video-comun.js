// Issue #44 (anexo "Importar video a Clip") — núcleo COMPARTIDO de
// extracción de video, igual para las 7 plataformas (Mercado Libre,
// Amazon, Temu, AliExpress, Alibaba, Shein, TikTok): busca un <video>/
// <source> con una URL de video DIRECTA (MP4, MOV o WEBM) en el HTML
// de la página que la persona ya tiene abierta, y como respaldo,
// cualquier URL del mismo tipo que aparezca suelta en el texto (cubre
// el caso real de que el <video> lo arma un script después de cargar,
// pero la URL YA viaja en el JSON incrustado de la página — mismo
// criterio que `leerDatosIncrustados` en lectores/mercadolibre.js).
//
// Es GENÉRICO a propósito: a diferencia de Mercado Libre/Amazon (con
// selectores reales confirmados en producción en el resto de esta
// carpeta), no hay ninguna evidencia confirmada de cómo Temu/Alibaba/
// Shein/TikTok embeben su video — <video>/<source> es el estándar
// real de HTML5, nunca una adivinanza de un sitio puntual (ver la
// regla de CLAUDE.md: nunca se adivina el comportamiento de un sitio
// externo sin evidencia real). Documentado en extension/LEEME.md: esta
// heurística puede no encontrar nada en un sitio puntual si ese sitio
// no usa <video>/<source> reales ni deja la URL del archivo suelta en
// el HTML — en ese caso, simplemente no aparece ningún video para
// traer, nunca se inventa uno.
//
// Nunca se reconstruye un stream (HLS/.m3u8) ni se resuelve un blob:
// local — si el ÚNICO video de la página es de uno de esos 2 tipos,
// se avisa como "no descargable" (ver `huboVideoNoDescargable`),
// nunca se intenta traerlo de otra forma.
(function () {
  "use strict";

  const PATRON_EXTENSION_VIDEO = /\.(mp4|mov|webm)$/i;
  const PATRON_URL_VIDEO_EN_TEXTO = /https:\/\/[^\s"'<>]+?\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/gi;
  const PATRON_MIME_VIDEO_DIRECTO = /^video\/(mp4|quicktime|webm)$/i;
  const PATRON_NO_DESCARGABLE_EN_TEXTO = /\.m3u8\b|blob:/i;

  // Solo vale una URL https de video DIRECTO — nunca un stream HLS
  // (.m3u8) ni un blob: local. Única fuente real de verdad sobre si
  // una URL puntual es válida — tanto `extraerUrlsVideoDeHtml` (abajo)
  // como cada lector la usan, nunca cada uno con su propio criterio.
  function esUrlVideoValida(url) {
    if (typeof url !== "string" || !url) return false;
    if (/^blob:/i.test(url)) return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (/\.m3u8$/i.test(parsed.pathname)) return false;
    return PATRON_EXTENSION_VIDEO.test(parsed.pathname);
  }

  // Lee src/type de un tag <video ...> o <source ...> a mano (regex
  // sobre el HTML como texto, nunca un DOM real — por eso esto se
  // puede probar con un HTML de ejemplo sin navegador, ver
  // video-comun.test.ts) — alcanza con lo que HTML5 realmente usa: src
  // entre comillas, type opcional.
  function atributosDeTag(tagHtml) {
    const src = tagHtml.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    const tipo = tagHtml.match(/\btype\s*=\s*["']([^"']+)["']/i);
    return { src: src ? src[1] : null, tipo: tipo ? tipo[1] : null };
  }

  // Devuelve { candidatos, huboVideoNoDescargable }:
  // - candidatos: URLs https de video directo confirmadas (nunca
  //   duplicadas) — puede haber más de una si la página tiene varios
  //   <video>/<source> (ej. una ficha con video de portada Y un video
  //   de reseña) o varias calidades del mismo video.
  // - huboVideoNoDescargable: true cuando se encontró un <video>/
  //   <source> real (o una URL .m3u8/blob: suelta en el HTML) pero
  //   NINGUNO de sus candidatos es una URL https de video directo —
  //   permite distinguir "hay un video, pero no se puede traer" de
  //   "esta página no tiene ningún video".
  function extraerUrlsVideoDeHtml(html) {
    const candidatos = new Set();
    let huboVideoNoDescargable = false;
    if (typeof html !== "string" || !html) return { candidatos: [], huboVideoNoDescargable };

    const tags = html.match(/<(?:video|source)\b[^>]*>/gi) || [];
    for (const tagHtml of tags) {
      const { src, tipo } = atributosDeTag(tagHtml);
      if (!src) continue;
      if (/^blob:/i.test(src) || /\.m3u8(?:[?#].*)?$/i.test(src)) {
        huboVideoNoDescargable = true;
        continue;
      }
      if (esUrlVideoValida(src) || (tipo && PATRON_MIME_VIDEO_DIRECTO.test(tipo) && /^https:/i.test(src))) {
        candidatos.add(src);
      }
    }

    // Respaldo: cualquier URL de video directa suelta en el texto (el
    // JSON incrustado de la página, por ejemplo) — nunca agrega una
    // .m3u8/blob: suelta como candidato, esas nunca matchean este
    // patrón a propósito.
    const sueltas = html.match(PATRON_URL_VIDEO_EN_TEXTO) || [];
    for (const url of sueltas) {
      if (esUrlVideoValida(url)) candidatos.add(url);
    }

    if (candidatos.size === 0 && PATRON_NO_DESCARGABLE_EN_TEXTO.test(html)) huboVideoNoDescargable = true;

    return { candidatos: Array.from(candidatos), huboVideoNoDescargable };
  }

  const api = { esUrlVideoValida, extraerUrlsVideoDeHtml };

  // Mismo patrón dual que extension/seguridad.js/extension/utilidades.js:
  // en el navegador real no existe `module` — este bloque solo corre
  // cuando vitest hace require()/import() del archivo, sin navegador.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixVideoComun = api;
  }
})();
