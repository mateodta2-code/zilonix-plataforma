import { describe, expect, it } from "vitest";
import { parsearFechaFalabella } from "./fechas";

describe("parsearFechaFalabella", () => {
  it("una fecha sin zona (formato de la documentación) se lee como hora de Colombia (UTC-5)", () => {
    expect(parsearFechaFalabella("2025-04-03 12:00:00").toISOString()).toBe("2025-04-03T17:00:00.000Z");
  });

  it("una fecha que ya trae zona se respeta tal cual", () => {
    expect(parsearFechaFalabella("2025-04-03T12:00:00+00:00").toISOString()).toBe("2025-04-03T12:00:00.000Z");
  });
});
