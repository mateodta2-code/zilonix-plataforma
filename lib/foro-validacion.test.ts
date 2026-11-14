import { describe, expect, it } from "vitest";
import { ForoError, LIMITES_FORO, patronBusqueda, validarPregunta, validarRespuesta } from "./foro-validacion";

describe("validarPregunta", () => {
  it("recorta espacios y junta el título en una sola línea", () => {
    expect(validarPregunta("  ¿Cómo  manejan\nFlex?  ", "  Tengo una duda con las devoluciones.  ")).toEqual({
      titulo: "¿Cómo manejan Flex?",
      cuerpo: "Tengo una duda con las devoluciones.",
    });
  });

  it("deja máximo una línea en blanco seguida en el cuerpo", () => {
    expect(validarPregunta("Título válido", "Primera línea\r\n\r\n\r\n\r\nSegunda línea").cuerpo).toBe("Primera línea\n\nSegunda línea");
  });

  it("rechaza títulos y cuerpos muy cortos o muy largos con un mensaje para la persona", () => {
    expect(() => validarPregunta("Hola", "Un cuerpo suficientemente largo")).toThrow(ForoError);
    expect(() => validarPregunta("x".repeat(LIMITES_FORO.tituloMax + 1), "Un cuerpo suficientemente largo")).toThrow(ForoError);
    expect(() => validarPregunta("Título válido", "corto")).toThrow(ForoError);
    expect(() => validarPregunta("Título válido", "x".repeat(LIMITES_FORO.cuerpoMax + 1))).toThrow(ForoError);
  });

  it("un valor que no es texto (FormData vacío) se trata como vacío, nunca revienta con otro error", () => {
    expect(() => validarPregunta(null, undefined)).toThrow(ForoError);
  });
});

describe("validarRespuesta", () => {
  it("acepta una respuesta corta y la recorta", () => {
    expect(validarRespuesta("  Sí  ")).toBe("Sí");
  });

  it("rechaza una respuesta vacía o demasiado larga", () => {
    expect(() => validarRespuesta("   ")).toThrow(ForoError);
    expect(() => validarRespuesta("x".repeat(LIMITES_FORO.respuestaMax + 1))).toThrow(ForoError);
  });
});

describe("patronBusqueda", () => {
  it("escapa los comodines de ILIKE para buscarlos literal", () => {
    expect(patronBusqueda("50%_off")).toBe("%50\\%\\_off%");
    expect(patronBusqueda("a\\b")).toBe("%a\\\\b%");
  });
});
