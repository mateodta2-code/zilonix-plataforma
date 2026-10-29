import { describe, expect, it } from "vitest";
// extension/lectores/tiktok.js es NUEVO (issue #44, anexo "Importar
// video a Clip") — a diferencia de los otros 6 lectores de esta
// carpeta, no investiga precio/vendidos, solo expone tipoDePagina y
// la extracción de video. Mismo patrón dual module.exports/window.X
// que el resto de la carpeta.
import { leerVideoDesdeHtml, tipoDePagina } from "./tiktok.js";

describe("tipoDePagina (TikTok) — issue #44 (anexo 'Importar video a Clip')", () => {
  it("un video individual real (@usuario/video/ID) -> 'video'", () => {
    expect(tipoDePagina("https://www.tiktok.com/@zilonixseller/video/7123456789012345678")).toBe("video");
  });

  it("el formato corto /v/ID.html también es 'video'", () => {
    expect(tipoDePagina("https://www.tiktok.com/v/7123456789012345678.html")).toBe("video");
  });

  it("el perfil de un usuario (sin /video/) -> null, nunca se adivina un video", () => {
    expect(tipoDePagina("https://www.tiktok.com/@zilonixseller")).toBe(null);
  });

  it("'Para ti'/explorar/búsqueda -> null", () => {
    expect(tipoDePagina("https://www.tiktok.com/foryou")).toBe(null);
    expect(tipoDePagina("https://www.tiktok.com/search?q=cojines")).toBe(null);
  });

  it("entradas no-string nunca revientan", () => {
    expect(tipoDePagina(undefined as unknown as string)).toBe(null);
    expect(tipoDePagina(null as unknown as string)).toBe(null);
  });
});

// leerVideoDesdeHtml acá es solo un delegado fino a
// extension/lectores/video-comun.js (ver ese archivo y su propia
// batería de pruebas) — estas pruebas confirman el cableado real de
// ESTE lector, nunca repiten cada caso de borde del núcleo compartido.
// El caso real de TikTok (URLs de CDN firmadas, sin extensión visible
// en el path) ya está cubierto en video-comun.test.ts vía el type
// "video/mp4" del <source> — acá solo se confirma que este lector lo
// hereda sin romper nada.
describe("leerVideoDesdeHtml (TikTok) — issue #44 (anexo 'Importar video a Clip')", () => {
  it("extrae la URL de un <video src> simple", () => {
    const html = `<video src="https://v16-webapp.tiktok.com/clip.mp4" controls></video>`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual(["https://v16-webapp.tiktok.com/clip.mp4"]);
    expect(resultado.huboVideoNoDescargable).toBe(false);
  });

  it("acepta un <source type=\"video/mp4\"> aunque la URL firmada no muestre la extensión en el path (caso real de TikTok)", () => {
    const html = `<source src="https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1200000" type="video/mp4">`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual(["https://v16-webapp.tiktok.com/abc123def456/?a=1988&br=1200000"]);
  });

  it("rechaza un stream HLS (.m3u8)", () => {
    const html = `<video><source src="https://v16-webapp.tiktok.com/clip.m3u8" type="application/x-mpegURL"></video>`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza un blob: local", () => {
    const html = `<video src="blob:https://www.tiktok.com/1234-5678"></video>`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza una URL que no es https", () => {
    const html = `<video src="http://v16-webapp.tiktok.com/clip.mp4"></video>`;
    expect(leerVideoDesdeHtml(html).candidatos).toEqual([]);
  });
});
