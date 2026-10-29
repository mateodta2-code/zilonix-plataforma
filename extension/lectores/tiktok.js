// Issue #44 (anexo "Importar video a Clip") — lector NUEVO, solo para
// TikTok. A diferencia de los otros 6 lectores de esta carpeta, TikTok
// no es un marketplace que esta extensión investigue (nunca hubo
// precio/vendidos/vendedor que leer acá) — este archivo expone
// ÚNICAMENTE lo que hace falta para "Importar video a Clip":
// tipoDePagina (para que content.js sepa cuándo mostrar el botón) y
// leerVideo (la URL del video, CON la marca de agua de TikTok — Mateo
// aceptó explícitamente que el clip venga así, nunca se intenta
// quitarla). Nunca un panel de investigación completo, nunca
// leerProducto/leerListado — content.js (ver reescanear(), tipo
// "video") no los necesita para este sitio.
//
// Mercado Libre puede rechazar en moderación un clip con el logo de
// TikkTok — documentado en extension/LEEME.md, responsabilidad de la
// persona al elegir cuál video subir, nunca de la extensión.
(function () {
  "use strict";
  // Mismo patrón dual que el resto de esta carpeta: en Node (vitest)
  // no existe `window`, se usa video-comun.js directo con require()
  // (archivo hermano, en esta misma carpeta); en el navegador (content
  // script real) `window` sí existe.
  const V = typeof window !== "undefined" ? window.ZilonixVideoComun : require("./video-comun.js");

  // Un TikTok individual real: tiktok.com/@usuario/video/1234567890123456789
  // (o /v/1234...html, el formato corto/viejo que TikTok sigue
  // resolviendo). Cualquier otra ruta (perfil, "Para ti", búsqueda,
  // explorar) no es la página de UN video puntual — nunca se intenta
  // adivinar un video ahí.
  const PATRON_VIDEO_TIKTOK = /\/@[^/]+\/video\/\d+/i;
  const PATRON_VIDEO_CORTO_TIKTOK = /\/v\/\d+/i;

  function tipoDePagina(url) {
    if (typeof url !== "string") return null;
    return PATRON_VIDEO_TIKTOK.test(url) || PATRON_VIDEO_CORTO_TIKTOK.test(url) ? "video" : null;
  }

  // Pura (string -> objeto) — ver el comentario completo en
  // extension/lectores/video-comun.js: heurística GENÉRICA compartida
  // por las 7 plataformas (<video>/<source> con una URL https de video
  // directo), nunca un selector propio de TikTok adivinado sin
  // evidencia real confirmada.
  function leerVideoDesdeHtml(html) {
    return V.extraerUrlsVideoDeHtml(html);
  }

  function leerVideo(doc) {
    const raiz = doc || document;
    const html = raiz && raiz.documentElement && typeof raiz.documentElement.outerHTML === "string" ? raiz.documentElement.outerHTML : "";
    return leerVideoDesdeHtml(html);
  }

  const api = { tipoDePagina, leerVideoDesdeHtml };

  // Mismo patrón dual module.exports/window.X que el resto de esta
  // carpeta: en el navegador real no existe `module`.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (typeof window !== "undefined") {
    window.ZilonixLectorActivo = { sitio: "TikTok", tipoDePagina, leerVideo };
  }
})();
