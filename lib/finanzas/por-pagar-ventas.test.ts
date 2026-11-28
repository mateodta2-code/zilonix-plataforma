import { describe, expect, it } from "vitest";
import { claveVentas, leerClaveVentas, tercerosDeLaVenta } from "./por-pagar-ventas";

// Por pagar automático (28-nov): a quién se le debe cada venta y la
// clave de la partida, sin base.

const HABITUALES = { empaque: "emp", agencia: "age", flex: "flx" };

describe("tercerosDeLaVenta", () => {
  it("empaque al habitual de empaque; envío al de agencia o Flex según la forma de entrega", () => {
    expect(tercerosDeLaVenta("agencia", { empaque: "1000.00", envio: "2000.00" }, HABITUALES)).toEqual({ empaqueTerceroId: "emp", envioTerceroId: "age" });
    expect(tercerosDeLaVenta("flex", { empaque: "1000.00", envio: "9000.00" }, HABITUALES)).toEqual({ empaqueTerceroId: "emp", envioTerceroId: "flx" });
  });

  it("Full no le debe envío a nadie; sin monto o en $0 no hay deuda", () => {
    expect(tercerosDeLaVenta("full_ml", { empaque: "1000.00", envio: "0.00" }, HABITUALES)).toEqual({ empaqueTerceroId: "emp", envioTerceroId: null });
    expect(tercerosDeLaVenta("agencia", { empaque: "0.00", envio: null }, HABITUALES)).toEqual({ empaqueTerceroId: null, envioTerceroId: null });
  });

  it("sin habitual marcado, ese concepto queda sin tercero", () => {
    expect(tercerosDeLaVenta("agencia", { empaque: "1000.00", envio: "2000.00" }, { empaque: null, agencia: null, flex: "flx" })).toEqual({
      empaqueTerceroId: null,
      envioTerceroId: null,
    });
  });
});

describe("claveVentas y leerClaveVentas", () => {
  const tercero = "3f2b8a10-1c2d-4e5f-8a9b-0c1d2e3f4a5b";

  it("ida y vuelta", () => {
    expect(leerClaveVentas(claveVentas(tercero, "2030-03-04", "COP"))).toEqual({ terceroId: tercero, desde: "2030-03-04", moneda: "COP" });
  });

  it("rechaza claves armadas a mano: sin uuid, fecha que no existe, moneda rara o texto extra", () => {
    expect(leerClaveVentas(`no-uuid|2030-03-04|COP`)).toBeNull();
    expect(leerClaveVentas(`${tercero}|2030-02-30|COP`)).toBeNull();
    expect(leerClaveVentas(`${tercero}|2030-03-04|PESOS`)).toBeNull();
    expect(leerClaveVentas(`${tercero}|2030-03-04|COP'; drop table gastos;--`)).toBeNull();
  });
});
