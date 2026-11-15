import { describe, expect, it } from "vitest";
import { MontoFalabellaInvalidoError, parsearMontoFalabella } from "./montos";

const ctx = { campo: "GrandTotal", orderId: "123456" };

describe("parsearMontoFalabella", () => {
  it.each([
    ["78000", "78000.00"],
    ["78000.00", "78000.00"],
    ["78,000.00", "78000.00"],
    ["1,234,567.89", "1234567.89"],
    ["78000.5", "78000.50"],
    [" 78,000.00 ", "78000.00"],
    ["0", "0.00"],
  ])("texto %s → %s", (entrada, esperado) => {
    expect(parsearMontoFalabella(entrada, ctx)).toBe(esperado);
  });

  it.each([
    [78000, "78000.00"],
    [78000.5, "78000.50"],
    [1234567.89, "1234567.89"],
  ])("número %s → %s", (entrada, esperado) => {
    expect(parsearMontoFalabella(entrada, ctx)).toBe(esperado);
  });

  it.each(["78.000,00", "78.000", "78,00", "7,8000.00", "1,234,56", "78000.123", "-78000", "", "abc", "1e5", "78 000"])(
    "rechaza %j sin adivinar",
    (entrada) => {
      expect(() => parsearMontoFalabella(entrada, ctx)).toThrow(MontoFalabellaInvalidoError);
    }
  );

  it("rechaza números no finitos, negativos y fuera de numeric(14,2)", () => {
    expect(() => parsearMontoFalabella(Number.NaN, ctx)).toThrow(MontoFalabellaInvalidoError);
    expect(() => parsearMontoFalabella(-1, ctx)).toThrow(MontoFalabellaInvalidoError);
    expect(() => parsearMontoFalabella("1234567890123", ctx)).toThrow(MontoFalabellaInvalidoError);
  });

  it("el error trae el campo y el OrderId", () => {
    try {
      parsearMontoFalabella("78.000,00", { campo: "ItemPrice", orderId: "999" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MontoFalabellaInvalidoError);
      expect((error as MontoFalabellaInvalidoError).campo).toBe("ItemPrice");
      expect((error as MontoFalabellaInvalidoError).orderId).toBe("999");
      expect((error as Error).message).toContain("ItemPrice");
      expect((error as Error).message).toContain("999");
    }
  });
});
