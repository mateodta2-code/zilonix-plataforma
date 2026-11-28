import { describe, expect, it } from "vitest";
import {
  DatosCompraInvalidosError,
  diasEntre,
  diasQueFaltan,
  fechaCorta,
  hoyBogota,
  notaRecepcion,
  sugerirCodigoSku,
  validarCodigoSku,
  validarDatosCompra,
} from "./registro-compras";

describe("Registro de compras — piezas puras (27-nov)", () => {
  it("sugiere SKU como el OS: FUL + 3 letras del nombre + 4 números", () => {
    expect(sugerirCodigoSku("Cepillo dientes eléctrico", () => 0.5716)).toBe("FULCEP5716");
    expect(sugerirCodigoSku("Ñandú árbol", () => 0.0007)).toBe("FULNAN0007");
    expect(sugerirCodigoSku("Luz", () => 0.577)).toBe("FULLUZ5770");
    expect(sugerirCodigoSku("12", () => 0.1)).toBe("FULXXX1000");
    expect(sugerirCodigoSku("Tabla", () => 0.99999)).toBe("FULTAB9999");
  });

  it("valida el código de SKU escrito a mano", () => {
    expect(validarCodigoSku(" fulcep5716 ")).toBe("FULCEP5716");
    expect(() => validarCodigoSku("ab")).toThrow(DatosCompraInvalidosError);
    expect(() => validarCodigoSku("FUL CEP")).toThrow(/sin espacios/);
  });

  it("limpia los datos de la compra y deja vacío lo que no se llenó", () => {
    expect(
      validarDatosCompra({
        fechaCompra: "2026-05-14",
        formaPago: "  MATEO   AMEX ",
        plataforma: "Amazon",
        ordenPlataforma: "",
        linkCompra: "https://www.amazon.com/dp/B0TEST",
        entregaEstimada: "2026-06-04",
      })
    ).toEqual({
      fechaCompra: "2026-05-14",
      formaPago: "MATEO AMEX",
      plataforma: "Amazon",
      ordenPlataforma: null,
      linkCompra: "https://www.amazon.com/dp/B0TEST",
      entregaEstimada: "2026-06-04",
    });
  });

  it("rechaza links que no son http(s), fechas irreales y textos largos", () => {
    expect(() => validarDatosCompra({ linkCompra: "javascript:alert(1)" })).toThrow(/https:\/\//);
    expect(() => validarDatosCompra({ linkCompra: "amazon.com/dp/1" })).toThrow(/enlace completo/);
    expect(() => validarDatosCompra({ fechaCompra: "2026-02-30" })).toThrow(/fecha real/);
    expect(() => validarDatosCompra({ plataforma: "x".repeat(41) })).toThrow(/40/);
  });

  it("cuenta días en llegar y días que faltan (solo si aún no llegó)", () => {
    expect(diasEntre("2026-05-14", "2026-06-04")).toBe(21);
    expect(diasEntre(null, "2026-06-04")).toBeNull();
    expect(diasQueFaltan("2026-12-05", null, "2026-11-27")).toBe(8);
    expect(diasQueFaltan("2026-11-20", null, "2026-11-27")).toBe(-7);
    expect(diasQueFaltan("2026-12-05", "2026-12-01", "2026-11-27")).toBeNull();
  });

  it("hoy en Bogotá no se adelanta con la hora UTC del servidor", () => {
    expect(hoyBogota(new Date("2026-11-28T03:00:00Z"))).toBe("2026-11-27");
  });

  it("la nota del kardex dice de qué OC son las unidades", () => {
    expect(notaRecepcion(12, "Factura 55")).toBe("OC-12 · Factura 55");
    expect(notaRecepcion(12, null)).toBe("OC-12");
    expect(notaRecepcion(null, "  ")).toBeNull();
  });

  it("fecha corta como el OS", () => {
    expect(fechaCorta("2026-05-14")).toBe("14 may 2026");
    expect(fechaCorta(null)).toBe("—");
  });
});
