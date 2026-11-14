import { describe, expect, it } from "vitest";
import { esUrlImagenForo, ForoError, LIMITES_FORO, patronBusqueda, validarImagenForo, validarPregunta, validarRespuesta } from "./foro-validacion";

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

describe("imagen del foro — solo nuestro Cloudinary, carpeta zilonix-foro", () => {
  const NUBE = "zilonix";
  const BUENA = "https://res.cloudinary.com/zilonix/image/upload/v1731600000/zilonix-foro/abc_123-XY.jpg";

  it("acepta la URL que devuelve /api/foro/imagen", () => {
    expect(esUrlImagenForo(BUENA, NUBE)).toBe(true);
    expect(esUrlImagenForo("https://res.cloudinary.com/zilonix/image/upload/zilonix-foro/abc.webp", NUBE)).toBe(true);
  });

  it("rechaza otros sitios, otra cuenta de Cloudinary, otra carpeta, http y parámetros", () => {
    expect(esUrlImagenForo("https://http2.mlstatic.com/D_NQ_NP_123.jpg", NUBE)).toBe(false);
    expect(esUrlImagenForo(BUENA.replace("/zilonix/", "/otra-nube/"), NUBE)).toBe(false);
    expect(esUrlImagenForo(BUENA.replace("zilonix-foro", "zilonix-plataforma"), NUBE)).toBe(false);
    expect(esUrlImagenForo(BUENA.replace("https://", "http://"), NUBE)).toBe(false);
    expect(esUrlImagenForo(`${BUENA}?x=1`, NUBE)).toBe(false);
    expect(esUrlImagenForo("https://res.cloudinary.com/zilonix/image/upload/zilonix-foro/../x.jpg", NUBE)).toBe(false);
    expect(esUrlImagenForo("https://res.cloudinary.com.evil.com/zilonix/image/upload/zilonix-foro/a.jpg", NUBE)).toBe(false);
  });

  it("sin Cloudinary configurado no se acepta ninguna", () => {
    expect(esUrlImagenForo(BUENA, undefined)).toBe(false);
  });

  it("validarImagenForo: vacío = sin imagen; una URL ajena se rechaza con mensaje, nunca se guarda en silencio", () => {
    expect(validarImagenForo(null, NUBE)).toBeNull();
    expect(validarImagenForo("  ", NUBE)).toBeNull();
    expect(validarImagenForo(BUENA, NUBE)).toBe(BUENA);
    expect(() => validarImagenForo("https://ejemplo.com/a.jpg", NUBE)).toThrow(ForoError);
  });
});
