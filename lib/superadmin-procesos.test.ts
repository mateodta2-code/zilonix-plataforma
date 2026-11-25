import { describe, expect, it } from "vitest";
import { etiquetaResumen, haceCuanto, semaforoDe, type EstadoProceso } from "./superadmin-procesos";

const ahora = new Date("2026-11-25T20:00:00Z");
const minAntes = (m: number) => new Date(ahora.getTime() - m * 60_000);
const proceso = (o: Partial<EstadoProceso>): EstadoProceso => ({
  proceso: "avisos_ml",
  ultimaTs: minAntes(2),
  ultimaOk: true,
  ultimoResumen: {},
  ultimoError: null,
  ultimaExitosaTs: minAntes(2),
  corridas24h: 1,
  fallidas24h: 0,
  ...o,
});

describe("semaforoDe", () => {
  it("sin corridas: sin datos", () => {
    expect(semaforoDe(proceso({ ultimaTs: null, ultimaOk: null }), ahora)).toBe("sin_datos");
  });

  it("la última falló: falló, aunque sea reciente", () => {
    expect(semaforoDe(proceso({ ultimaOk: false }), ahora)).toBe("fallo");
  });

  it("avisos: al día hasta 15 min, atrasado después", () => {
    expect(semaforoDe(proceso({ ultimaTs: minAntes(15) }), ahora)).toBe("al_dia");
    expect(semaforoDe(proceso({ ultimaTs: minAntes(16) }), ahora)).toBe("atrasado");
  });

  it("cada proceso tiene su propio margen", () => {
    expect(semaforoDe(proceso({ proceso: "publicidad", ultimaTs: minAntes(2 * 60) }), ahora)).toBe("al_dia");
    expect(semaforoDe(proceso({ proceso: "publicidad", ultimaTs: minAntes(4 * 60) }), ahora)).toBe("atrasado");
    expect(semaforoDe(proceso({ proceso: "seguimiento", ultimaTs: minAntes(20 * 60) }), ahora)).toBe("al_dia");
    expect(semaforoDe(proceso({ proceso: "seguimiento", ultimaTs: minAntes(27 * 60) }), ahora)).toBe("atrasado");
  });
});

describe("haceCuanto", () => {
  it("minutos, horas y días", () => {
    expect(haceCuanto(ahora, ahora)).toBe("hace menos de 1 min");
    expect(haceCuanto(minAntes(5), ahora)).toBe("hace 5 min");
    expect(haceCuanto(minAntes(130), ahora)).toBe("hace 2 h");
    expect(haceCuanto(minAntes(24 * 60), ahora)).toBe("hace 1 día");
    expect(haceCuanto(minAntes(3 * 24 * 60), ahora)).toBe("hace 3 días");
  });
});

describe("etiquetaResumen", () => {
  it("traduce las claves conocidas y deja las otras tal cual", () => {
    expect(etiquetaResumen("procesados")).toBe("Procesados");
    expect(etiquetaResumen("omitidosSinCuenta")).toBe("Omitidos (cuenta no conectada)");
    expect(etiquetaResumen("nuevaClave")).toBe("nuevaClave");
  });
});
