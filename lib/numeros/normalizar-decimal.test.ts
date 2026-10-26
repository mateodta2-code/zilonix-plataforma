import { describe, expect, it } from "vitest";
import { DecimalInvalidoError, aEscala, normalizarDecimal } from "./normalizar-decimal";

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
  });
});
