import { describe, expect, it } from "vitest";
import {
  esFechaValida,
  estaVencido,
  filtrarGastos,
  GastoInvalidoError,
  leerFiltrosGastos,
  leerTienda,
  mesDeDia,
  resumirGastos,
  validarGasto,
  validarPago,
  type EntradaGasto,
  type GastoResumen,
} from "./gastos";

// Issue #422 (fase 4 de Finanzas) — lógica pura de gastos externos.

const CAT = "11111111-1111-4111-8111-111111111111";
const CAT2 = "22222222-2222-4222-8222-222222222222";
const CUENTA = "33333333-3333-4333-8333-333333333333";

function entrada(cambios: Partial<EntradaGasto> = {}): EntradaGasto {
  return {
    tienda: "",
    categoriaId: CAT,
    terceroId: "",
    beneficiario: "Arrendador",
    descripcion: " Arriendo bodega ",
    monto: "1500000",
    fechaGasto: "2026-11-05",
    fechaVencimiento: "",
    pagado: false,
    fechaPago: "",
    medioPago: "",
    soporte: "",
    ...cambios,
  };
}

function gasto(cambios: Partial<GastoResumen> = {}): GastoResumen {
  return {
    cuentaMlId: null,
    cuentaFalabellaId: null,
    categoriaId: CAT,
    monto: "100.00",
    moneda: "COP",
    fechaGasto: "2026-11-10",
    fechaVencimiento: null,
    estado: "pendiente",
    ...cambios,
  };
}

describe("validarGasto", () => {
  it("limpia textos y deja pendiente sin fecha de pago", () => {
    const v = validarGasto(entrada());
    expect(v).toMatchObject({ descripcion: "Arriendo bodega", beneficiario: "Arrendador", terceroId: null, estado: "pendiente", fechaPago: null, tienda: null });
  });

  it("pagado exige fecha de pago válida", () => {
    expect(() => validarGasto(entrada({ pagado: true }))).toThrow(GastoInvalidoError);
    expect(validarGasto(entrada({ pagado: true, fechaPago: "2026-11-06" }))).toMatchObject({ estado: "pagado", fechaPago: "2026-11-06" });
  });

  it("ignora la fecha de pago si no está marcado como pagado (CHECK gastos_pago_coherente)", () => {
    expect(validarGasto(entrada({ fechaPago: "2026-11-06" })).fechaPago).toBeNull();
  });

  it("exige proveedor o beneficiario", () => {
    expect(() => validarGasto(entrada({ beneficiario: "  " }))).toThrow(/proveedor o escribe/);
    expect(validarGasto(entrada({ beneficiario: "", terceroId: CAT2 })).terceroId).toBe(CAT2);
  });

  it("rechaza monto 0, negativo o con más de 2 decimales", () => {
    for (const monto of ["0", "-5", "10.555", "abc", ""]) {
      expect(() => validarGasto(entrada({ monto }))).toThrow();
    }
  });

  it("rechaza categoría, tienda y fechas inválidas", () => {
    expect(() => validarGasto(entrada({ categoriaId: "x" }))).toThrow(/categoría/);
    expect(() => validarGasto(entrada({ tienda: "ml:no-uuid" }))).toThrow(/tienda/);
    expect(() => validarGasto(entrada({ fechaGasto: "2026-02-30" }))).toThrow(/fecha del gasto/);
    expect(() => validarGasto(entrada({ fechaVencimiento: "mañana" }))).toThrow(/vencimiento/);
  });

  it("lee la tienda de Mercado Libre o Falabella", () => {
    expect(validarGasto(entrada({ tienda: `ml:${CUENTA}` })).tienda).toEqual({ marketplace: "ml", cuentaId: CUENTA });
    expect(leerTienda(`falabella:${CUENTA}`)).toEqual({ marketplace: "falabella", cuentaId: CUENTA });
    expect(leerTienda(`shopify:${CUENTA}`)).toBeNull();
  });
});

describe("validarPago y fechas", () => {
  it("exige fecha real", () => {
    expect(() => validarPago("2026-13-01", "")).toThrow(GastoInvalidoError);
    expect(validarPago("2026-11-20", " Nequi ")).toEqual({ fechaPago: "2026-11-20", medioPago: "Nequi" });
  });

  it("esFechaValida y mesDeDia", () => {
    expect(esFechaValida("2028-02-29")).toBe(true);
    expect(esFechaValida("2026-02-29")).toBe(false);
    expect(mesDeDia("2026-02-14")).toEqual({ desde: "2026-02-01", hasta: "2026-02-28" });
    expect(mesDeDia("2026-12-31")).toEqual({ desde: "2026-12-01", hasta: "2026-12-31" });
  });
});

describe("leerFiltrosGastos", () => {
  it("sin parámetros = mes en curso, sin filtros", () => {
    expect(leerFiltrosGastos({}, "2026-11-22")).toEqual({ desde: "2026-11-01", hasta: "2026-11-30", tienda: null, categoriaId: null, estado: null });
  });

  it("lista blanca: ignora lo que no reconoce e invierte un rango al revés", () => {
    const f = leerFiltrosGastos(
      { desde: "2026-11-30", hasta: "2026-11-01", tienda: "'; drop table", categoria: "x", estado: "borrado" },
      "2026-11-22"
    );
    expect(f).toEqual({ desde: "2026-11-01", hasta: "2026-11-30", tienda: null, categoriaId: null, estado: null });
    expect(leerFiltrosGastos({ tienda: `ml:${CUENTA}`, estado: "vencido", categoria: CAT }, "2026-11-22")).toMatchObject({
      tienda: `ml:${CUENTA}`,
      estado: "vencido",
      categoriaId: CAT,
    });
    expect(leerFiltrosGastos({ tienda: "empresa" }, "2026-11-22").tienda).toBe("empresa");
  });
});

describe("estado, filtros y totales", () => {
  const hoy = "2026-11-22";

  it("vencido = pendiente con vencimiento antes de hoy", () => {
    expect(estaVencido({ estado: "pendiente", fechaVencimiento: "2026-11-21" }, hoy)).toBe(true);
    expect(estaVencido({ estado: "pendiente", fechaVencimiento: "2026-11-22" }, hoy)).toBe(false);
    expect(estaVencido({ estado: "pagado", fechaVencimiento: "2026-11-01" }, hoy)).toBe(false);
    expect(estaVencido({ estado: "pendiente", fechaVencimiento: null }, hoy)).toBe(false);
  });

  it("resume por moneda sin mezclar: total del mes, todo lo pendiente y lo vencido", () => {
    const totales = resumirGastos(
      [
        gasto({ monto: "100.10", estado: "pagado" }),
        gasto({ monto: "50.05", fechaVencimiento: "2026-11-01" }),
        // Mes anterior, pendiente: no suma al mes pero sí a pendiente.
        gasto({ monto: "1000", fechaGasto: "2026-10-15", fechaVencimiento: "2026-10-30" }),
        gasto({ monto: "7", moneda: "MXN" }),
      ],
      hoy
    );
    expect(totales).toEqual([
      { moneda: "COP", totalMes: "150.15", pendiente: "1050.05", vencido: "1050.05" },
      { moneda: "MXN", totalMes: "7.00", pendiente: "7.00", vencido: "0.00" },
    ]);
  });

  it("filtra por rango, tienda, categoría y estado", () => {
    const deTienda = gasto({ cuentaMlId: CUENTA });
    const otraCat = gasto({ categoriaId: CAT2, estado: "pagado" });
    const viejo = gasto({ fechaGasto: "2026-10-01", fechaVencimiento: "2026-10-05" });
    const todos = [gasto(), deTienda, otraCat, viejo];
    const base = leerFiltrosGastos({}, hoy);
    expect(filtrarGastos(todos, base, hoy)).toHaveLength(3);
    expect(filtrarGastos(todos, { ...base, tienda: `ml:${CUENTA}` }, hoy)).toEqual([deTienda]);
    expect(filtrarGastos(todos, { ...base, tienda: "empresa" }, hoy)).toHaveLength(2);
    expect(filtrarGastos(todos, { ...base, categoriaId: CAT2 }, hoy)).toEqual([otraCat]);
    expect(filtrarGastos(todos, { ...base, estado: "pagado" }, hoy)).toEqual([otraCat]);
    expect(filtrarGastos(todos, { ...base, desde: "2026-10-01", estado: "vencido" }, hoy)).toEqual([viejo]);
  });
});
