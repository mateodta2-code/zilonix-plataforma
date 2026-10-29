import { describe, expect, it } from "vitest";
// extension/lectores/video-comun.js es JS plano (corre como content
// script de la extensión) pero exporta estas funciones con
// `module.exports` cuando `module` existe (mismo patrón que
// extension/seguridad.js/lectores/mercadolibre.js) — alcanza para
// probarlas con un HTML de ejemplo, sin navegador ni DOM real.
import { esUrlVideoValida, extraerUrlsVideoDeHtml } from "./video-comun.js";

describe("esUrlVideoValida — issue #44 (anexo 'Importar video a Clip')", () => {
  it("una URL https de video directo (.mp4) es válida", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/MCO123/clip.mp4")).toBe(true);
  });

  it(".mov y .webm también son válidos", () => {
    expect(esUrlVideoValida("https://cdn.shein.com/clip.mov")).toBe(true);
    expect(esUrlVideoValida("https://cdn.temu.com/clip.webm")).toBe(true);
  });

  it("una URL con query string después de la extensión sigue siendo válida", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.mp4?sig=abc123&x=1")).toBe(true);
  });

  it("rechaza un stream HLS (.m3u8) — nunca se reconstruye un stream", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.m3u8")).toBe(false);
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.m3u8?token=abc")).toBe(false);
  });

  it("rechaza un blob: local — nunca se intenta resolver un blob de otra pestaña", () => {
    expect(esUrlVideoValida("blob:https://articulo.mercadolibre.com.co/1234-5678-90ab")).toBe(false);
  });

  it("rechaza una URL que no es https (http, o sin protocolo)", () => {
    expect(esUrlVideoValida("http://video.mercadolibre.com/clip.mp4")).toBe(false);
    expect(esUrlVideoValida("//video.mercadolibre.com/clip.mp4")).toBe(false);
    expect(esUrlVideoValida("video.mercadolibre.com/clip.mp4")).toBe(false);
  });

  it("rechaza una URL sin extensión de video reconocida", () => {
    expect(esUrlVideoValida("https://video.mercadolibre.com/clip.gif")).toBe(false);
    expect(esUrlVideoValida("https://video.mercadolibre.com/pagina.html")).toBe(false);
  });

  it("entradas no-string o vacías nunca revientan", () => {
    expect(esUrlVideoValida(null as unknown as string)).toBe(false);
    expect(esUrlVideoValida(undefined as unknown as string)).toBe(false);
    expect(esUrlVideoValida("")).toBe(false);
    expect(esUrlVideoValida(123 as unknown as string)).toBe(false);
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

  it("acepta un <source> con type=\"video/mp4\" aunque la URL no muestre la extensión en el path (caso real de CDNs firmadas, ej. TikTok)", () => {
    const html = `<source src="https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1" type="video/mp4">`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual(["https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1"]);
  });

  it("encuentra una URL de video suelta en el JSON incrustado de la página (sin ningún <video> real todavía)", () => {
    const html = `<script>window.__DATA__ = {"producto":{"video":{"playAddr":"https://p16.tiktokcdn.com/abc/def/video.mp4?x=1"}}};</script>`;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos).toEqual(["https://p16.tiktokcdn.com/abc/def/video.mp4?x=1"]);
  });

  it("varios videos en la misma página -> todos los candidatos, sin duplicados", () => {
    const html = `
      <video src="https://cdn.amazon.com/producto/clip1.mp4"></video>
      <video src="https://cdn.amazon.com/producto/clip2.webm"></video>
      <source src="https://cdn.amazon.com/producto/clip1.mp4" type="video/mp4">
    `;
    const resultado = extraerUrlsVideoDeHtml(html);
    expect(resultado.candidatos.sort()).toEqual(["https://cdn.amazon.com/producto/clip1.mp4", "https://cdn.amazon.com/producto/clip2.webm"].sort());
  });

  it("rechaza un <source> con un stream HLS (.m3u8) -- avisa 'no descargable', nunca lo agrega como candidato", () => {
    const html = `<video controls><source src="https://video.alibaba.com/clip.m3u8" type="application/x-mpegURL"></video>`;
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
