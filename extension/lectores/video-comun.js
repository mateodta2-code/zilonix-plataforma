// Issue #44 (anexo "Importar video a Clip") — núcleo COMPARTIDO de
// extracción y VALIDACIÓN de video, igual para las 7 plataformas
// (Mercado Libre, Amazon, Temu, AliExpress, Alibaba, Shein, TikTok):
// busca un <video>/<source> con una URL de video DIRECTA (MP4, MOV o
// WEBM) en el HTML de la página que la persona ya tiene abierta, y
// como respaldo, cualquier URL del mismo tipo que aparezca suelta en
// el texto (cubre el caso real de que el <video> lo arma un script
// después de cargar, pero la URL YA viaja en el JSON incrustado de la
// página — mismo criterio que `leerDatosIncrustados` en
// lectores/mercadolibre.js).
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
// Nunca se reconstruye un stream (HLS/.m3u8, DASH/.mpd) ni se resuelve
// un blob:/data: local — si el ÚNICO video de la página es de uno de
// esos tipos, se avisa como "no descargable" (ver
// `huboVideoNoDescargable`), nunca se intenta traerlo de otra forma.
//
// Revisión de Pablo (sobre a6fdcbd, HIGH 1) — bug real: hasta esta
// corrección, esta función aceptaba un `<source type="video/mp4">`
// sin extensión en CUALQUIER host https (caso real de TikTok, cuyas
// URLs firmadas de CDN no siempre muestran ".mp4" en el path), pero
// `esUrlVideoDirectaValida` en background.js era una función DISTINTA
// y más estricta (solo aceptaba con extensión real) — background.js
// rechazaba en silencio justo el caso que este archivo decía haber
// confirmado. Ahora es LA MISMA función real en los dos lados
// (background.js la carga con `importScripts`, ver ese archivo) y el
// `type` del tag (controlado por la propia página, nunca una prueba
// real) deja de ser suficiente por sí solo: una URL SIN extensión
// reconocible solo se acepta si su HOST es uno de los CDNs de video
// confirmados de las 7 fuentes (`SUFIJOS_HOST_CDN_VIDEO_PERMITIDOS`,
// abajo) — un dominio ajeno, aunque la página diga `type="video/mp4"`,
// nunca pasa.
(function () {
  "use strict";

  const PATRON_EXTENSION_VIDEO = /\.(mp4|mov|webm)$/i;
  const PATRON_EXTENSION_NO_DESCARGABLE = /\.(m3u8|mpd)$/i;
  const PATRON_URL_VIDEO_EN_TEXTO = /https:\/\/[^\s"'<>]+?\.(?:mp4|mov|webm)(?:\?[^\s"'<>]*)?/gi;
  const PATRON_NO_DESCARGABLE_EN_TEXTO = /\.m3u8\b|\.mpd\b|blob:|data:/i;

  // CDNs reales de video de las 7 fuentes que esta extensión soporta
  // — anclados por hostname (termina en ".dominio" o es exactamente
  // igual, NUNCA un substring: "evil-tiktokcdn.com" y
  // "tiktokcdn.com.evil.com" tienen que quedar afuera los dos). Solo
  // importa cuando una URL de video NO tiene extensión reconocible
  // (ver esUrlVideoValida) — con extensión real (.mp4/.mov/.webm)
  // alcanza esa extensión sola, sin importar el host.
  const SUFIJOS_HOST_CDN_VIDEO_PERMITIDOS = [
    "tiktok.com",
    "tiktokcdn.com",
    "mlstatic.com",
    "amazon.com",
    "media-amazon.com",
    "temu.com",
    "kwcdn.com",
    "alicdn.com",
    "shein.com",
    "ltwebstatic.com",
  ];

  function hostEsCdnVideoPermitido(hostname) {
    if (typeof hostname !== "string" || !hostname) return false;
    const h = hostname.toLowerCase();
    return SUFIJOS_HOST_CDN_VIDEO_PERMITIDOS.some((sufijo) => h === sufijo || h.endsWith(`.${sufijo}`));
  }

  // Única fuente real de verdad sobre si una URL puntual es un video
  // directo traíble — tanto `extraerUrlsVideoDeHtml` (abajo) como
  // background.js (vía importScripts/require, nunca una copia
  // separada) la usan. Solo vale https; nunca blob:/data: (streams
  // locales de la propia pestaña, nunca algo que se pueda volver a
  // pedir desde background.js) ni un stream HLS (.m3u8) o DASH (.mpd).
  function esUrlVideoValida(url) {
    if (typeof url !== "string" || !url) return false;
    if (/^(blob|data):/i.test(url)) return false;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:") return false;
    if (PATRON_EXTENSION_NO_DESCARGABLE.test(parsed.pathname)) return false;
    if (PATRON_EXTENSION_VIDEO.test(parsed.pathname)) return true;
    // Sin extensión reconocible (caso real de CDNs firmadas, ej.
    // TikTok) — solo se confía en el HOST, nunca en lo que la propia
    // página declare sobre esa URL (un `type` de un <source> es
    // markup de la página, no una prueba real).
    return hostEsCdnVideoPermitido(parsed.hostname);
  }

  // Lee el atributo src de un tag <video ...> o <source ...> a mano
  // (regex sobre el HTML como texto, nunca un DOM real — por eso esto
  // se puede probar con un HTML de ejemplo sin navegador, ver
  // video-comun.test.ts).
  function srcDeTag(tagHtml) {
    const m = tagHtml.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
    return m ? m[1] : null;
  }

  // Devuelve { candidatos, huboVideoNoDescargable }:
  // - candidatos: URLs https de video directo confirmadas (nunca
  //   duplicadas) — puede haber más de una si la página tiene varios
  //   <video>/<source> (ej. una ficha con video de portada Y un video
  //   de reseña) o varias calidades del mismo video.
  // - huboVideoNoDescargable: true cuando se encontró un <video>/
  //   <source> real (o una URL .m3u8/.mpd/blob:/data: suelta en el
  //   HTML) pero NINGUNO de sus candidatos es una URL https de video
  //   directo — permite distinguir "hay un video, pero no se puede
  //   traer" de "esta página no tiene ningún video".
  function extraerUrlsVideoDeHtml(html) {
    const candidatos = new Set();
    let huboVideoNoDescargable = false;
    if (typeof html !== "string" || !html) return { candidatos: [], huboVideoNoDescargable };

    const tags = html.match(/<(?:video|source)\b[^>]*>/gi) || [];
    for (const tagHtml of tags) {
      const src = srcDeTag(tagHtml);
      if (!src) continue;
      if (esUrlVideoValida(src)) {
        candidatos.add(src);
      } else if (/^(blob|data):/i.test(src) || /\.(m3u8|mpd)(?:[?#].*)?$/i.test(src)) {
        huboVideoNoDescargable = true;
      }
    }

    // Respaldo: cualquier URL de video directa (CON extensión) suelta
    // en el texto (el JSON incrustado de la página, por ejemplo) —
    // nunca agrega una .m3u8/.mpd/blob:/data: suelta como candidato,
    // esas nunca matchean este patrón a propósito. A propósito NO se
    // extiende este respaldo a una URL sin extensión en un host
    // permitido: fuera de un <video>/<source> real, cualquier URL en
    // un CDN de imágenes/JS legítimo podría colarse como falso
    // positivo — acá se prefiere quedarse corto que inventar un video.
    const sueltas = html.match(PATRON_URL_VIDEO_EN_TEXTO) || [];
    for (const url of sueltas) {
      if (esUrlVideoValida(url)) candidatos.add(url);
    }

    if (candidatos.size === 0 && PATRON_NO_DESCARGABLE_EN_TEXTO.test(html)) huboVideoNoDescargable = true;

    return { candidatos: Array.from(candidatos), huboVideoNoDescargable };
  }

  const api = { esUrlVideoValida, extraerUrlsVideoDeHtml };

  // Mismo patrón dual module.exports/globalThis.X que el resto de la
  // extensión — `globalThis` (en vez de `window`) a propósito desde
  // esta revisión: background.js es un Service Worker (sin `window`,
  // solo `self`/`globalThis`) y ahora también carga este archivo
  // (`importScripts`, ver background.js) para usar la MISMA
  // esUrlVideoValida — `globalThis` es el único global real que
  // existe en los 3 contextos (content script, Service Worker, Node/
  // vitest). En un content script, `window === globalThis`, así que
  // los lectores que leen `window.ZilonixVideoComun` siguen
  // funcionando sin ningún cambio.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.ZilonixVideoComun = api;
  }
})();
