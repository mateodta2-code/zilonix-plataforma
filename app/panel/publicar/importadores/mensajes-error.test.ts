import { describe, expect, it } from "vitest";
import { mensajeErrorImportarLink } from "./mensajes-error";

// Mismo motivo que clip/mensajes-error.test.ts — importadores/actions.ts
// nunca manda texto libre en ?importarLinkError=, solo un código de una
// lista cerrada; un código desconocido o cualquier texto pegado a mano
// en la URL nunca se muestra tal cual.
describe("mensajeErrorImportarLink — solo texto fijo de un mapa código->mensaje, nunca el valor crudo de la URL", () => {
  it("sin código: no muestra nada", () => {
    expect(mensajeErrorImportarLink(undefined)).toBeNull();
  });

  it("código real conocido: devuelve su texto fijo", () => {
    expect(mensajeErrorImportarLink("formato")).toMatch(/no se reconoció/i);
    expect(mensajeErrorImportarLink("sin_cuenta")).toMatch(/ninguna cuenta/i);
  });

  it("código desconocido/arbitrario (ej. pegado a mano en la URL, con intento de HTML) -> mensaje genérico, nunca el valor tal cual", () => {
    const intentoInyeccion = "<script>alert(1)</script>";
    const mensaje = mensajeErrorImportarLink(intentoInyeccion);
    expect(mensaje).not.toContain(intentoInyeccion);
    expect(mensaje).not.toContain("<script>");
    expect(mensaje).toMatch(/no se pudo importar/i);
  });

  it("cada código de la lista cerrada que usa importadores/actions.ts tiene un mensaje propio (ninguno cae en el genérico)", () => {
    const codigos = ["formato", "sin_cuenta"];
    const generico = mensajeErrorImportarLink("codigo_desconocido");
    for (const codigo of codigos) {
      expect(mensajeErrorImportarLink(codigo), `"${codigo}" no tiene mensaje propio`).not.toBeNull();
      expect(mensajeErrorImportarLink(codigo), `"${codigo}" cayó en el mensaje genérico`).not.toBe(generico);
    }
  });
});
