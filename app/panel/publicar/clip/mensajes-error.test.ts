import { describe, expect, it } from "vitest";
import { mensajeErrorClip } from "./mensajes-error";

// Tarea 2.11 — app/api/ml/clip/route.ts nunca manda texto libre en
// ?error=, solo un código de una lista cerrada. Esta pantalla tiene
// que reflejar esa misma garantía del otro lado: un código que no está
// en el mapa (o cualquier texto arbitrario que alguien pegue a mano en
// la URL) nunca se muestra tal cual, siempre el mensaje genérico.
describe("mensajeErrorClip — solo texto fijo de un mapa código->mensaje, nunca el valor crudo de la URL", () => {
  it("sin código: no muestra nada", () => {
    expect(mensajeErrorClip(undefined)).toBeNull();
  });

  it("código real conocido: devuelve su texto fijo", () => {
    expect(mensajeErrorClip("cuenta_desconectada")).toMatch(/desconectada/i);
    expect(mensajeErrorClip("demasiado_grande")).toMatch(/280MB/);
  });

  it("código desconocido/arbitrario (ej. pegado a mano en la URL, con intento de HTML) -> mensaje genérico, nunca el valor tal cual", () => {
    const intentoInyeccion = "<script>alert(1)</script>";
    const mensaje = mensajeErrorClip(intentoInyeccion);
    expect(mensaje).not.toContain(intentoInyeccion);
    expect(mensaje).not.toContain("<script>");
    expect(mensaje).toMatch(/no se pudo subir/i);
  });

  it("cada código de la lista cerrada que usa app/api/ml/clip/route.ts tiene un mensaje propio (ninguno cae en el genérico)", () => {
    const codigos = [
      "sin_permiso",
      "faltan_datos",
      "archivo_invalido",
      "demasiado_grande",
      "cuenta_invalida",
      "item_invalido",
      "cuenta_desconectada",
      "reputacion_requerida",
      "sin_respuesta_ml",
      "rechazado_ml",
    ];
    const generico = mensajeErrorClip("error_desconocido");
    for (const codigo of codigos) {
      expect(mensajeErrorClip(codigo), `"${codigo}" no tiene mensaje propio en MENSAJES_ERROR_CLIP`).not.toBeNull();
      expect(mensajeErrorClip(codigo), `"${codigo}" cayó en el mensaje genérico`).not.toBe(generico);
    }
  });
});
