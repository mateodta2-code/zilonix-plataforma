import { describe, expect, it } from "vitest";
import { DecimalInvalidoError, aEscala, cabeEnNumeric, normalizarDecimal, textoDeNumeroJson } from "./normalizar-decimal";

describe("normalizarDecimal (issue #254)", () => {
  it("acepta punto decimal, coma decimal y miles con coma decimal", () => {
    expect(normalizarDecimal("1234.56")).toBe("1234.56");
    expect(normalizarDecimal("1,5")).toBe("1.5");
    expect(normalizarDecimal("1.234,56")).toBe("1234.56");
    expect(normalizarDecimal("3992.0")).toBe("3992.0");
    expect(normalizarDecimal("1.234.567")).toBe("1234567");
    expect(normalizarDecimal("1,234,567.89")).toBe("1234567.89");
  });

  it("rechaza vacío, texto y lo ambiguo", () => {
    expect(() => normalizarDecimal("")).toThrow(DecimalInvalidoError);
    expect(() => normalizarDecimal("   ")).toThrow(DecimalInvalidoError);
    expect(() => normalizarDecimal("abc")).toThrow(DecimalInvalidoError);
    expect(() => normalizarDecimal("1.234")).toThrow(/ambiguo/);
    expect(() => normalizarDecimal("1,234")).toThrow(/ambiguo/);
    expect(() => normalizarDecimal("12.34.567")).toThrow(DecimalInvalidoError);
  });

  it("en COP sin decimales, 1.234 son miles", () => {
    expect(normalizarDecimal("1.234", { copSinDecimales: true })).toBe("1234");
    expect(normalizarDecimal("1,234", { copSinDecimales: true })).toBe("1234");
  });

  it("aEscala no pasa por float", () => {
    expect(aEscala("3992.0", 2)).toBe("3992.00");
    expect(aEscala("1.234,56", 2)).toBe("1234.56");
    // `1.005` a secas es ambiguo (podría ser miles). En un número JSON
    // el punto ya es decimal: 1.005 redondeado a 2 queda 1.01, sin float.
    expect(() => aEscala("1.005", 2)).toThrow(/ambiguo/);
    expect(aEscala("1.005", 2, { origenJson: true })).toBe("1.01");
    expect(aEscala("0.5714285714285714", 4, { origenJson: true })).toBe("0.5714");
  });

  it("expande la notación científica de JSON sin pasar por float", () => {
    expect(textoDeNumeroJson(1e-7)).toBe("0.0000001");
    expect(textoDeNumeroJson(1.23e-7)).toBe("0.000000123");
    expect(aEscala(textoDeNumeroJson(1e-7), 2, { origenJson: true })).toBe("0.00");
  });

  it("numeric(14,2) rechaza una parte entera de más de 12 dígitos", () => {
    expect(cabeEnNumeric("999999999999.99", 14, 2)).toBe(true);
    expect(cabeEnNumeric("1000000000000.00", 14, 2)).toBe(false);
  });
});
