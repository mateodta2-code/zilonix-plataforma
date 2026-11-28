import { describe, expect, it, vi } from "vitest";

// Sin base: db/index.ts exige DATABASE_URL_APP al importarse.
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));

import {
  asignarSkusAleatorios,
  fechaCreacionBogota,
  formatearSkuAleatorio,
  mismoCodigoSku,
  prefijoSkuAleatorio,
  siguienteNumeroSku,
  SkuAleatorioAgotadoError,
  SkuCodigoInvalidoFormatoError,
  SkuYaExisteError,
  validarCodigoManual,
  validarNombreProducto,
  validarStockInicial,
} from "./crear-producto";
import { SkuCodigoDuplicadoError } from "@/lib/ml/sku";

// Issue #280 — «Crear producto (SKU)», funciones puras.
describe("SKU aleatorio", () => {
  it("prefijo: 3 primeras letras sin tildes, ñ → N, completa con X", () => {
    expect(prefijoSkuAleatorio("Linterna")).toBe("LIN");
    expect(prefijoSkuAleatorio("Árbol")).toBe("ARB");
    expect(prefijoSkuAleatorio("Árbol de Navidad")).toBe("ARB");
    expect(prefijoSkuAleatorio("Ñandú")).toBe("NAN");
    expect(prefijoSkuAleatorio("7 en 1")).toBe("ENX");
    expect(prefijoSkuAleatorio(" ab ")).toBe("ABX");
    expect(prefijoSkuAleatorio("!!!")).toBe("XXX");
  });

  it("formato FUL + prefijo + 4 dígitos", () => {
    expect(formatearSkuAleatorio("Linterna", 1)).toBe("FULLIN0001");
    expect(formatearSkuAleatorio("Linterna", 25)).toBe("FULLIN0025");
    expect(() => formatearSkuAleatorio("Linterna", 10000)).toThrow(SkuAleatorioAgotadoError);
  });

  it("siguiente número: un solo contador por empresa, ignora lo que no cumple el formato", () => {
    expect(siguienteNumeroSku([])).toBe(1);
    expect(siguienteNumeroSku(["FULLIN0001", "FULCAM0007", "001", "ABC0100", "FULLIN00010"])).toBe(8);
    expect(siguienteNumeroSku(["fullin0003"])).toBe(4);
  });

  it("pasar de 9999 da un error claro", () => {
    expect(() => siguienteNumeroSku(["FULLIN9999"])).toThrow(SkuAleatorioAgotadoError);
    expect(() => siguienteNumeroSku(["FULLIN9999"])).toThrow("Se acabaron los números de SKU aleatorio (9999); usa un SKU manual.");
  });

  it("asignación en carga masiva: consecutiva y sin repetir los ocupados", () => {
    const ocupados = new Set(["FULCAM0006"]);
    expect(asignarSkusAleatorios(["Linterna", "Cama", "Cama"], 5, ocupados)).toEqual(["FULLIN0005", "FULCAM0007", "FULCAM0008"]);
  });
});

describe("SKU manual", () => {
  it("acepta cualquier código válido y lo normaliza", () => {
    expect(validarCodigoManual("001")).toBe("001");
    expect(validarCodigoManual(" ab-1 ")).toBe("AB-1");
    expect(validarCodigoManual("x_y.z")).toBe("X_Y.Z");
  });

  it("rechaza espacios internos, vacío, caracteres raros y más de 60", () => {
    expect(() => validarCodigoManual("a b")).toThrow(SkuCodigoInvalidoFormatoError);
    expect(() => validarCodigoManual("")).toThrow(SkuCodigoInvalidoFormatoError);
    expect(() => validarCodigoManual("   ")).toThrow(SkuCodigoInvalidoFormatoError);
    expect(() => validarCodigoManual("ñandú")).toThrow(SkuCodigoInvalidoFormatoError);
    expect(() => validarCodigoManual("A".repeat(61))).toThrow(SkuCodigoInvalidoFormatoError);
    expect(validarCodigoManual("A".repeat(60))).toHaveLength(60);
  });

  it("duplicado sin distinguir mayúsculas ni espacios", () => {
    expect(mismoCodigoSku("001 ", "001")).toBe(true);
    expect(mismoCodigoSku("abc", "ABC")).toBe(true);
    expect(mismoCodigoSku("ABC", "ABD")).toBe(false);
  });

  it("el error de repetido es un SkuCodigoDuplicadoError con el producto", () => {
    const error = new SkuYaExisteError("001", "Linterna");
    expect(error).toBeInstanceOf(SkuCodigoDuplicadoError);
    expect(error.message).toBe('Ya existe un SKU con el código "001" en tu empresa (producto: Linterna).');
  });
});

describe("otras validaciones", () => {
  it("nombre obligatorio y hasta 200", () => {
    expect(validarNombreProducto("  Linterna   recargable ")).toBe("Linterna recargable");
    expect(() => validarNombreProducto(" ")).toThrow();
    expect(() => validarNombreProducto("a".repeat(201))).toThrow();
  });

  it("stock entero entre 0 y el máximo", () => {
    expect(validarStockInicial(0)).toBe(0);
    expect(validarStockInicial(10)).toBe(10);
    expect(() => validarStockInicial(-1)).toThrow();
    expect(() => validarStockInicial(1.5)).toThrow();
    expect(() => validarStockInicial(Number.NaN)).toThrow();
    expect(() => validarStockInicial(1_000_001)).toThrow();
  });

  it("fecha de creación en Bogotá", () => {
    expect(fechaCreacionBogota(new Date("2026-11-28T03:04:00Z"))).toBe("2026-11-27 22:04");
  });
});
