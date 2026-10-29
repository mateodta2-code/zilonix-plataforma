import { describe, expect, it } from "vitest";
import { problemasDeVideoClip } from "./validacion-video-cliente";

const VALIDO = { duracionSegundos: 30, ancho: 400, alto: 700, tamanoBytes: 1024 };

describe("problemasDeVideoClip (duplicado cliente) — rama feat-publicar-clip, punto 2", () => {
  it("un video que cumple todo: sin problemas", () => {
    expect(problemasDeVideoClip(VALIDO)).toEqual([]);
  });

  it("menos de 10 segundos -> duracion_corta", () => {
    expect(problemasDeVideoClip({ ...VALIDO, duracionSegundos: 5 })).toEqual(["duracion_corta"]);
  });

  it("más de 61 segundos -> duracion_larga", () => {
    expect(problemasDeVideoClip({ ...VALIDO, duracionSegundos: 90 })).toEqual(["duracion_larga"]);
  });

  it("horizontal (ancho >= alto) -> no_vertical", () => {
    expect(problemasDeVideoClip({ ...VALIDO, ancho: 700, alto: 680 })).toEqual(["no_vertical"]);
  });

  it("por debajo de 360x640 -> resolucion_baja", () => {
    expect(problemasDeVideoClip({ ...VALIDO, ancho: 200, alto: 350 })).toEqual(["resolucion_baja"]);
  });

  it("más de 280MB -> demasiado_grande", () => {
    expect(problemasDeVideoClip({ ...VALIDO, tamanoBytes: 300 * 1024 * 1024 })).toEqual(["demasiado_grande"]);
  });

  it("varios problemas a la vez: devuelve TODOS, nunca solo el primero", () => {
    const problemas = problemasDeVideoClip({ duracionSegundos: 5, ancho: 700, alto: 400, tamanoBytes: 300 * 1024 * 1024 });
    expect(problemas).toEqual(["duracion_corta", "no_vertical", "resolucion_baja", "demasiado_grande"]);
  });
});
