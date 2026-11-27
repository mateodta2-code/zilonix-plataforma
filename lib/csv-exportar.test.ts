import { describe, expect, it } from "vitest";
import { armarCsv, celdaCsv, fechaArchivoBogota, fechaIsoBogota } from "./csv-exportar";

describe("csv-exportar (issue #280)", () => {
  it("empieza con BOM y usa coma y \\r\\n", () => {
    const csv = armarCsv(["a", "b"], [[1, "x"]]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe("﻿a,b\r\n1,x\r\n");
  });

  it("coma, comillas y salto de línea dentro de una celda van entre comillas", () => {
    expect(celdaCsv("uno, dos")).toBe('"uno, dos"');
    expect(celdaCsv('dice "hola"')).toBe('"dice ""hola"""');
    expect(celdaCsv("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
  });

  it.each([
    ["=SUM(A1)", "'=SUM(A1)"],
    ["+1", "'+1"],
    ["-2", "'-2"],
    ["@x", "'@x"],
    ["\tx", "'\tx"],
    ["\rx", "\"'\rx\""],
  ])("el texto %j que parece fórmula queda como texto", (entrada, esperado) => {
    expect(celdaCsv(entrada)).toBe(esperado);
  });

  it("un número negativo no se escapa", () => {
    expect(celdaCsv(-5)).toBe("-5");
    expect(armarCsv(["delta"], [[-5]])).toBe("﻿delta\r\n-5\r\n");
  });

  it("números sin separador de miles; vacío para null/undefined", () => {
    expect(celdaCsv(12345)).toBe("12345");
    expect(celdaCsv(null)).toBe("");
    expect(celdaCsv(undefined)).toBe("");
  });

  it("tildes y ñ intactas", () => {
    expect(celdaCsv("Piñata Medellín")).toBe("Piñata Medellín");
  });

  it("fechas en hora de Colombia", () => {
    const fecha = new Date("2026-11-28T03:30:15.123Z");
    expect(fechaIsoBogota(fecha)).toBe("2026-11-27T22:30:15-05:00");
    expect(fechaArchivoBogota(fecha)).toBe("2026-11-27");
  });
});
