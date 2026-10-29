import { describe, expect, it } from "vitest";
import { urlDeMensajeExtensionVideo } from "./recibir-mensaje-extension";

const PROPIO = "https://staging.test";
const MENSAJE_VALIDO = { fuente: "zilonix-extension", tipo: "importar-video", payload: { url: "https://export-download.canva.com/video.mp4" } };

describe("urlDeMensajeExtensionVideo — rama feat-publicar-clip, punto 1 (receptor de postMessage de la extensión)", () => {
  it("origen propio + mensaje válido -> devuelve la URL", () => {
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, MENSAJE_VALIDO)).toBe("https://export-download.canva.com/video.mp4");
  });

  it("origen distinto al esperado -> null, aunque el payload sea válido (nunca confía en un mensaje de otro origen)", () => {
    expect(urlDeMensajeExtensionVideo("https://sitio-ajeno.test", PROPIO, MENSAJE_VALIDO)).toBeNull();
  });

  it("fuente distinta de 'zilonix-extension' -> null", () => {
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, { ...MENSAJE_VALIDO, fuente: "otra-cosa" })).toBeNull();
  });

  it("tipo distinto de 'importar-video' (ej. el 'importar-publicar' del formulario) -> null, nunca lo confunde", () => {
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, { ...MENSAJE_VALIDO, tipo: "importar-publicar" })).toBeNull();
  });

  it("sin payload.url, o con un tipo que no es string -> null", () => {
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, { fuente: "zilonix-extension", tipo: "importar-video", payload: {} })).toBeNull();
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, { fuente: "zilonix-extension", tipo: "importar-video", payload: { url: 12345 } })).toBeNull();
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, { fuente: "zilonix-extension", tipo: "importar-video", payload: { url: "" } })).toBeNull();
  });

  it("datos nulos/indefinidos/de otra forma -> null, nunca lanza", () => {
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, null)).toBeNull();
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, undefined)).toBeNull();
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, "texto")).toBeNull();
    expect(urlDeMensajeExtensionVideo(PROPIO, PROPIO, 123)).toBeNull();
  });
});
