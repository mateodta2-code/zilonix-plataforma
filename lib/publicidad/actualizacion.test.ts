import { describe, expect, it } from "vitest";
import { syncActualizoDatos } from "./actualizacion";

describe("fecha de la última sync del tablero (issue #255)", () => {
  it("ok y parcial actualizaron datos; un corte de tiempo también", () => {
    expect(syncActualizoDatos("ok", null)).toBe(true);
    expect(syncActualizoDatos("parcial", null)).toBe(true);
    expect(syncActualizoDatos("error", "CorridaIncompletaError: fase:dias. corte")).toBe(true);
    expect(syncActualizoDatos("error", "CorridaIncompletaError: fase:pre-dias. corte")).toBe(true);
  });

  it("un error real o una corrida en curso no cuentan como actualización", () => {
    expect(syncActualizoDatos("error", "Error: 500")).toBe(false);
    expect(syncActualizoDatos("error", null)).toBe(false);
    expect(syncActualizoDatos("en_curso", null)).toBe(false);
  });
});
