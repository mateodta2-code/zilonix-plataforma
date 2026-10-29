import { describe, expect, it } from "vitest";
// extension/lectores/amazon.js solo exporta leerVideoDesdeHtml con
// module.exports (issue #44, anexo "Importar video a Clip") — el
// resto del lector (leerProducto/leerListado) toca DOM real y no se
// prueba directo, mismo criterio que el resto de esta carpeta.
import { leerVideoDesdeHtml } from "./amazon.js";

// leerVideoDesdeHtml acá es solo un delegado fino a
// extension/lectores/video-comun.js (ver ese archivo y su propia
// batería de pruebas) — estas pruebas confirman el cableado real de
// ESTE lector, nunca repiten cada caso de borde del núcleo compartido.
describe("leerVideoDesdeHtml (Amazon) — issue #44 (anexo 'Importar video a Clip')", () => {
  it("extrae la URL de un <video src> de ejemplo", () => {
    const html = `<div id="main-video-player"><video src="https://m.media-amazon.com/images/producto/clip.mp4" controls></video></div>`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual(["https://m.media-amazon.com/images/producto/clip.mp4"]);
    expect(resultado.huboVideoNoDescargable).toBe(false);
  });

  it("rechaza un stream HLS (.m3u8)", () => {
    const html = `<video><source src="https://m.media-amazon.com/clip.m3u8" type="application/x-mpegURL"></video>`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza un blob: local", () => {
    const html = `<video src="blob:https://www.amazon.com/1234-5678"></video>`;
    const resultado = leerVideoDesdeHtml(html);
    expect(resultado.candidatos).toEqual([]);
    expect(resultado.huboVideoNoDescargable).toBe(true);
  });

  it("rechaza una URL que no es https", () => {
    const html = `<video src="http://m.media-amazon.com/clip.mp4"></video>`;
    expect(leerVideoDesdeHtml(html).candidatos).toEqual([]);
  });
});
