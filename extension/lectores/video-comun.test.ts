import { describe, expect, it } from "vitest";
// extension/lectores/video-comun.js es JS plano (corre como content
// script de la extensión, y también como Service Worker — ver
// background.js, que lo carga con importScripts) pero exporta estas
// funciones con `module.exports` cuando `module` existe (mismo patrón
// que extension/seguridad.js/lectores/mercadolibre.js) — alcanza para
// probarlas con un HTML de ejemplo, sin navegador ni DOM real.
import { esUrlVideoValida, extraerUrlsVideoDeHtml } from "./video-comun.js";

// Revisión de Pablo (sobre a6fdcbd, HIGH 1) — esUrlVideoValida es
// ahora LA MISMA función real que usa background.js (nunca una copia
// separada y desalineada) — con extensión real (.mp4/.mov/.webm)
// alcanza en cualquier host; SIN extensión (caso real de CDNs
// firmadas, ej. TikTok) solo se confía en el HOST si está en la
// allowlist anclada de las 7 fuentes — nunca en lo que la propia
// página declare (un `type="video/mp4"` es markup de la página, no
// una prueba real).
describe("esUrlVideoValida — issue #44 (anexo 'Importar video a Clip')", () => {
  it("una URL https de video directo (.mp4) es válida", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/MCO123/clip.mp4")).toBe(true);
  });

  it(".mov y .webm también son válidos, en cualquier host (la extensión real alcanza sola)", () => {
    expect(esUrlVideoValida("https://cdn.cualquier-sitio-random.com/clip.mov")).toBe(true);
    expect(esUrlVideoValida("https://cdn.cualquier-sitio-random.com/clip.webm")).toBe(true);
  });

  it("una URL con query string después de la extensión sigue siendo válida", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.mp4?sig=abc123&x=1")).toBe(true);
  });

  it("rechaza un stream HLS (.m3u8) — nunca se reconstruye un stream", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.m3u8")).toBe(false);
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.m3u8?token=abc")).toBe(false);
  });

  it("rechaza un stream DASH (.mpd) — mismo criterio que .m3u8", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.mpd")).toBe(false);
  });

  it("rechaza un blob: local — nunca se intenta resolver un blob de otra pestaña", () => {
    expect(esUrlVideoValida("blob:https://articulo.mercadolibre.com.co/1234-5678-90ab")).toBe(false);
  });

  it("rechaza un data: -- nunca un video incrustado como base64", () => {
    expect(esUrlVideoValida("data:video/mp4;base64,AAAA")).toBe(false);
  });

  it("rechaza una URL que no es https (http, o sin protocolo)", () => {
    expect(esUrlVideoValida("http://video.mercadolibre.com/clip.mp4")).toBe(false);
    expect(esUrlVideoValida("//video.mercadolibre.com/clip.mp4")).toBe(false);
    expect(esUrlVideoValida("video.mercadolibre.com/clip.mp4")).toBe(false);
  });

  it("rechaza una URL sin extensión de video reconocida en un host que NO está en la allowlist", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.gif")).toBe(false);
    expect(esUrlVideoValida("https://video.mercadolibre.com/pagina.html")).toBe(false);
    expect(esUrlVideoValida("https://cdn.sitio-cualquiera.com/clip-sin-extension")).toBe(false);
  });

  it("entradas no-string o vacías nunca revientan", () => {
    expect(esUrlVideoValida(null as unknown as string)).toBe(false);
    expect(esUrlVideoValida(undefined as unknown as string)).toBe(false);
    expect(esUrlVideoValida("")).toBe(false);
    expect(esUrlVideoValida(123 as unknown as string)).toBe(false);
  });

  // Caso real reportado por Pablo: las URLs firmadas de CDN de TikTok
  // no siempre muestran ".mp4" en el path — sin extensión, SOLO se
  // confía en el host si es un CDN de video confirmado de una de las
  // 7 fuentes.
  it("sin extensión, en un host de la allowlist (tiktok/tiktokcdn/mlstatic/amazon/media-amazon/temu/kwcdn/alicdn/shein/ltwebstatic) -> válida", () => {
    expect(esUrlVideoValida("https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1200000")).toBe(true);
    expect(esUrlVideoValida("https://p16.tiktokcdn.com/abc/def/video?x=1")).toBe(true);
    expect(esUrlVideoValida("https://http2.mlstatic.com/producto/video-sin-extension")).toBe(true);
    expect(esUrlVideoValida("https://m.media-amazon.com/images/producto/video-sin-extension")).toBe(true);
    expect(esUrlVideoValida("https://a.kwcdn.com/producto/video-sin-extension")).toBe(true);
    expect(esUrlVideoValida("https://ae01.alicdn.com/kf/producto/video-sin-extension")).toBe(true);
    expect(esUrlVideoValida("https://img.ltwebstatic.com/producto/video-sin-extension")).toBe(true);
  });

  it("sin extensión, en un host que NO es un CDN confirmado -> rechazada, aunque 'parezca' un video", () => {
    expect(esUrlVideoValida("https://cdn.sitio-cualquiera.com/video-de-producto")).toBe(false);
  });

  // Spoofing real (pedido explícito de Pablo) — el ancla tiene que ser
  // por hostname completo, nunca un substring.
  it("rechaza spoofs de dominio: tiktokcdn.com.evil.com y evil-tiktokcdn.com", () => {
    expect(esUrlVideoValida("https://tiktokcdn.com.evil.com/video-sin-extension")).toBe(false);
    expect(esUrlVideoValida("https://evil-tiktokcdn.com/video-sin-extension")).toBe(false);
  });

  it("rechaza otros spoofs equivalentes sobre el resto de la allowlist", () => {
    expect(esUrlVideoValida("https://mlstatic.com.evil.com/video-sin-extension")).toBe(false);
    expect(esUrlVideoValida("https://evil-mlstatic.com/video-sin-extension")).toBe(false);
    expect(esUrlVideoValida("https://amazon.com.evil.com/video-sin-extension")).toBe(false);
  });
});

describe("extraerUrlsVideoDeHtml — issue #44 (anexo 'Importar video a Clip')", () => {
  it("extrae la URL de un <video src> simple", () => {
    const html = `<div><video src="https://video.mercadolibre.com/MCO123/clip.mp4" controls></video></div>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual(["https://video.mercadolibre.com/MCO123/clip.mp4"]);
    expect(resultado.huboVideoNoDescargable).toBe(false);
  });

  it("extrae la URL de un <source src> dentro de <video>", () => {
    const html = `<video controls><source src="https://cdn.shein.com/clips/abc.mp4" type="video/mp4"></video>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual(["https://cdn.shein.com/clips/abc.mp4"]);
  });

  it("acepta un <source> SIN extensión en un host de la allowlist (caso real de CDNs firmadas, ej. TikTok) -- el atributo type ya NO decide nada", () => {
    const html = `<source src="https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1">`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual(["https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1"]);
  });

  // Revisión de Pablo (MED 3) — hasta esta corrección, un
  // `type="video/mp4"` alcanzaba para aceptar CUALQUIER host https sin
  // extensión; ahora el host tiene que estar en la allowlist, pase lo
  // que diga `type`.
  it("un <source type=\"video/mp4\"> SIN extensión en un host que NO es un CDN confirmado -> nunca se agrega como candidato", () => {
    const html = `<source src="https://evil.com/video-de-producto" type="video/mp4">`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
  });

  it("encuentra una URL de video (CON extensión) suelta en el JSON incrustado de la página", () => {
    const html = `<script>window.__DATA__ = {"producto":{"video":{"playAddr":"https://p16.tiktokcdn.com/abc/def/video.mp4?x=1"}}};</script>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual(["https://p16.tiktokcdn.com/abc/def/video.mp4?x=1"]);
  });

  it("varios videos en la misma página -> todos los candidatos, sin duplicados", () => {
    const html = `
      <video src="https://m.media-amazon.com/producto/clip1.mp4"></video>
      <video src="https://m.media-amazon.com/producto/clip2.webm"></video>
      <source src="https://m.media-amazon.com/producto/clip1.mp4" type="video/mp4">
    `;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos.sort()).toEqual(["https://m.media-amazon.com/producto/clip1.mp4", "https://m.media-amazon.com/producto/clip2.webm"].sort());
  });

  it("rechaza un <source> con un stream HLS (.m3u8) -- avisa 'no descargable', nunca lo agrega como candidato", () => {
    const html = `<video controls><source src="https://video.alibaba.com/clip.m3u8" type="application/x-mpegURL"></video>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza un <source> con un stream DASH (.mpd) -- avisa 'no descargable'", () => {
    const html = `<video><source src="https://video.alibaba.com/clip.mpd" type="application/dash+xml"></video>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza un <video src> con un blob: local -- avisa 'no descargable'", () => {
    const html = `<video src="blob:https://articulo.mercadolibre.com.co/1234-5678"></video>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza un <video src> con un data: -- avisa 'no descargable'", () => {
    const html = `<video src="data:video/mp4;base64,AAAA"></video>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza una URL de video que no es https (queda afuera de los candidatos, sin marcar 'no descargable')", () => {
    const html = `<video src="http://cdn.aliexpress.com/clip.mp4"></video>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(false);
  });

  it("una página sin ningún <video>/<source> ni URL de video suelta -> sin candidatos, sin aviso de 'no descargable'", () => {
    const html = `<div class="ficha"><h1>Un producto cualquiera</h1><img src="https://cdn.temu.com/foto.jpg"></div>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(false);
  });

  it("entradas vacías o no-string nunca revientan", () => {
    expect(extraerUrlsVideoDeHtml("")).toEqual({ candidatos: [], huboVideoNoDescargable: false });
    expect(extraerUrlsVideoDeHtml(null as unknown as string)).toEqual({ candidatos: [], huboVideoNoDescargable: false });
    expect(extraerUrlsVideoDeHtml(undefined as unknown as string)).toEqual({ candidatos: [], huboVideoNoDescargable: false });
  });
});
