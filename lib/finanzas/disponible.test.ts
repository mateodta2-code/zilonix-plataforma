import { describe, expect, it } from "vitest";
import {
  armarFilas,
  DisponibleInvalidoError,
  esDesactualizado,
  filasDesdeCuentasMp,
  historialDeCuenta,
  MONEDAS_DISPONIBLE,
  saldoVigente,
  sumarSaldos,
  totalesPorMoneda,
  totalesPorTipo,
  validarCuenta,
  validarSaldo,
  type CuentaDisponible,
  type CuentaMpDisponible,
  type SaldoDisponible,
} from "./disponible";
import { SITIOS_ML } from "@/lib/ml/sitios";

// Issue #422 (fase 6, Disponible) — lógica pura: saldo vigente, totales y
// desactualizado.

const HOY = "2026-11-22";

function cuenta(id: string, extra: Partial<CuentaDisponible> = {}): CuentaDisponible {
  return { id, nombre: id, tipo: "banco", entidad: "Banco", ultimos4: null, moneda: "COP", activa: true, ...extra };
}

let n = 0;
function saldo(cuentaId: string, valor: string, fechaCorte: string, creado = "2026-11-01T00:00:00Z"): SaldoDisponible {
  n += 1;
  return { id: `s${n}`, cuentaId, saldo: valor, fechaCorte, nota: null, registradoPor: null, creadoTs: new Date(creado) };
}

describe("saldoVigente", () => {
  it("gana la fecha de corte más reciente, no la última registrada", () => {
    const viejo = saldo("a", "100.00", "2026-11-20", "2026-11-21T10:00:00Z");
    const nuevo = saldo("a", "50.00", "2026-11-21", "2026-11-21T09:00:00Z");
    expect(saldoVigente([nuevo, viejo])).toBe(nuevo);
  });

  it("mismo día de corte: gana el último registrado (una corrección)", () => {
    const primero = saldo("a", "100.00", "2026-11-21", "2026-11-21T09:00:00Z");
    const correccion = saldo("a", "90.00", "2026-11-21", "2026-11-21T12:00:00Z");
    expect(saldoVigente([correccion, primero])).toBe(correccion);
  });

  it("sin saldos: null", () => {
    expect(saldoVigente([])).toBeNull();
  });

  it("el historial queda del más nuevo al más viejo y su primero es el vigente", () => {
    const s = [saldo("a", "1", "2026-11-01"), saldo("a", "3", "2026-11-10"), saldo("b", "9", "2026-11-15"), saldo("a", "2", "2026-11-05")];
    const historial = historialDeCuenta(s, "a");
    expect(historial.map((h) => h.saldo)).toEqual(["3", "2", "1"]);
    expect(historial[0]).toBe(saldoVigente(s.filter((x) => x.cuentaId === "a")));
  });
});

describe("esDesactualizado", () => {
  it("7 días exactos todavía no; 8 sí", () => {
    expect(esDesactualizado("2026-11-15", HOY)).toBe(false);
    expect(esDesactualizado("2026-11-14", HOY)).toBe(true);
  });

  it("cruza meses y años sin errores", () => {
    expect(esDesactualizado("2025-12-31", "2026-01-07")).toBe(false);
    expect(esDesactualizado("2025-12-30", "2026-01-07")).toBe(true);
  });

  it("una cuenta sin saldo no se marca desactualizada", () => {
    expect(esDesactualizado(null, HOY)).toBe(false);
  });
});

describe("totales", () => {
  const cuentas = [
    cuenta("banco1"),
    cuenta("banco2"),
    cuenta("nequi", { tipo: "billetera" }),
    cuenta("caja", { tipo: "efectivo", entidad: null }),
    cuenta("mx", { moneda: "MXN" }),
    cuenta("inactiva", { activa: false }),
    cuenta("vacia"),
  ];
  const saldos = [
    saldo("banco1", "1000000.10", "2026-11-21"),
    saldo("banco1", "5.00", "2026-11-01"),
    saldo("banco2", "-200.05", "2026-11-10"),
    saldo("nequi", "0.20", "2026-11-22"),
    saldo("caja", "300000", "2026-11-20"),
    saldo("mx", "50.00", "2026-11-22"),
    saldo("inactiva", "999999.00", "2026-11-22"),
  ];
  const filas = armarFilas(cuentas, saldos, HOY);

  it("cada fila trae su saldo vigente y si está desactualizado", () => {
    expect(filas.find((f) => f.id === "banco1")).toMatchObject({ saldo: "1000000.10", fechaCorte: "2026-11-21", desactualizado: false });
    expect(filas.find((f) => f.id === "banco2")).toMatchObject({ saldo: "-200.05", desactualizado: true });
    expect(filas.find((f) => f.id === "vacia")).toMatchObject({ saldo: null, fechaCorte: null, desactualizado: false });
  });

  it("total por moneda, sin mezclar monedas ni contar inactivas o sin saldo", () => {
    expect(totalesPorMoneda(filas)).toEqual([
      { moneda: "COP", total: "1299800.25", cuentas: 4, corteMasAntiguo: "2026-11-10", corteMasReciente: "2026-11-22", desactualizadas: 1 },
      { moneda: "MXN", total: "50.00", cuentas: 1, corteMasAntiguo: "2026-11-22", corteMasReciente: "2026-11-22", desactualizadas: 0 },
    ]);
  });

  it("por tipo: bancos, billeteras y efectivo, siempre los tres", () => {
    const porTipo = totalesPorTipo(filas);
    expect(porTipo.map((t) => t.tipo)).toEqual(["banco", "billetera", "efectivo"]);
    expect(porTipo[0].totales.map((t) => [t.moneda, t.total])).toEqual([
      ["COP", "999800.05"],
      ["MXN", "50.00"],
    ]);
    expect(porTipo[1].totales.map((t) => t.total)).toEqual(["0.20"]);
    expect(porTipo[2].totales.map((t) => t.total)).toEqual(["300000.00"]);
  });

  it("suma en centavos, sin errores de coma flotante", () => {
    expect(sumarSaldos(["0.10", "0.20"])).toBe("0.30");
    expect(sumarSaldos(["-0.50", "0.20"])).toBe("-0.30");
    expect(sumarSaldos([])).toBe("0.00");
  });
});

describe("filasDesdeCuentasMp", () => {
  function cuentaMp(id: string, extra: Partial<CuentaMpDisponible> = {}): CuentaMpDisponible {
    return {
      id,
      cuentaIdExterna: `ext-${id}`,
      nickname: null,
      ultimoSaldoDisponible: null,
      ultimaMoneda: null,
      ultimoCorteFecha: null,
      ultimoSaldoTs: null,
      reportePendienteFile: null,
      reportePendienteTs: null,
      ultimoErrorSaldo: null,
      ...extra,
    };
  }

  const cuentasMp = [
    cuentaMp("mp1", { nickname: "TIENDA", ultimoSaldoDisponible: "1500.50", ultimaMoneda: "COP", ultimoCorteFecha: "2026-11-21" }),
    cuentaMp("mp2", { ultimoSaldoDisponible: "-0.50", ultimaMoneda: "COP", ultimoCorteFecha: "2026-11-01" }),
    cuentaMp("mp3", { ultimoSaldoDisponible: "10.00", ultimaMoneda: "MXN", ultimoCorteFecha: "2026-11-22" }),
    // Sin sincronizar: no suma.
    cuentaMp("mp4", { reportePendienteFile: "zilonix-release-1.csv" }),
  ];

  it("solo cuentas sincronizadas, como billeteras de Mercado Pago con id mp:", () => {
    const filas = filasDesdeCuentasMp(cuentasMp, HOY);
    expect(filas.map((f) => f.id)).toEqual(["mp:mp1", "mp:mp2", "mp:mp3"]);
    expect(filas[0]).toEqual({
      id: "mp:mp1",
      nombre: "TIENDA",
      tipo: "billetera",
      entidad: "Mercado Pago",
      ultimos4: null,
      moneda: "COP",
      activa: true,
      saldo: "1500.50",
      fechaCorte: "2026-11-21",
      desactualizado: false,
    });
    expect(filas[1]).toMatchObject({ nombre: "ext-mp2", desactualizado: true });
  });

  it("suman a totalesPorMoneda y a Billeteras en totalesPorTipo", () => {
    const manuales = armarFilas([cuenta("banco1"), cuenta("nequi", { tipo: "billetera" })], [saldo("banco1", "100.00", "2026-11-22"), saldo("nequi", "0.20", "2026-11-22")], HOY);
    const todas = [...manuales, ...filasDesdeCuentasMp(cuentasMp, HOY)];
    expect(totalesPorMoneda(todas)).toEqual([
      { moneda: "COP", total: "1600.20", cuentas: 4, corteMasAntiguo: "2026-11-01", corteMasReciente: "2026-11-22", desactualizadas: 1 },
      { moneda: "MXN", total: "10.00", cuentas: 1, corteMasAntiguo: "2026-11-22", corteMasReciente: "2026-11-22", desactualizadas: 0 },
    ]);
    const porTipo = totalesPorTipo(todas);
    expect(porTipo[0].totales.map((t) => [t.moneda, t.total])).toEqual([["COP", "100.00"]]);
    expect(porTipo[1].totales.map((t) => [t.moneda, t.total])).toEqual([
      ["COP", "1500.20"],
      ["MXN", "10.00"],
    ]);
  });
});

describe("validación", () => {
  it("monedas salen de SITIOS_ML", () => {
    expect(MONEDAS_DISPONIBLE.sort()).toEqual(Array.from(new Set(Object.values(SITIOS_ML).map((s) => s.moneda))).sort());
  });

  it("cuenta: entidad obligatoria salvo efectivo, últimos 4 exactos y moneda conocida", () => {
    const base = { nombre: " Ahorros ", tipo: "banco", entidad: "Bancolombia", ultimos4: "1234", moneda: "COP" };
    expect(validarCuenta(base)).toEqual({ nombre: "Ahorros", tipo: "banco", entidad: "Bancolombia", ultimos4: "1234", moneda: "COP" });
    expect(validarCuenta({ ...base, tipo: "efectivo", entidad: "", ultimos4: "" })).toMatchObject({ entidad: null, ultimos4: null });
    expect(() => validarCuenta({ ...base, entidad: " " })).toThrow(DisponibleInvalidoError);
    expect(() => validarCuenta({ ...base, ultimos4: "12a4" })).toThrow(DisponibleInvalidoError);
    expect(() => validarCuenta({ ...base, moneda: "USD" })).toThrow(DisponibleInvalidoError);
    expect(() => validarCuenta({ ...base, tipo: "cripto" })).toThrow(DisponibleInvalidoError);
  });

  it("saldo: formato colombiano, negativo para sobregiro, nunca fecha futura", () => {
    expect(validarSaldo({ saldo: "1.234.567,89", fechaCorte: HOY, nota: "" }, HOY)).toEqual({ saldo: "1234567.89", fechaCorte: HOY, nota: null });
    expect(validarSaldo({ saldo: "-2.000", fechaCorte: "2026-11-01", nota: " extracto " }, HOY)).toEqual({
      saldo: "-2000.00",
      fechaCorte: "2026-11-01",
      nota: "extracto",
    });
    expect(() => validarSaldo({ saldo: "", fechaCorte: HOY, nota: "" }, HOY)).toThrow(DisponibleInvalidoError);
    // Ambiguo (¿dos mil o dos?): se rechaza, no se adivina (leerMonto).
    expect(() => validarSaldo({ saldo: "2,000", fechaCorte: HOY, nota: "" }, HOY)).toThrow(/ambiguo/);
    expect(() => validarSaldo({ saldo: "abc", fechaCorte: HOY, nota: "" }, HOY)).toThrow(DisponibleInvalidoError);
    expect(() => validarSaldo({ saldo: "10", fechaCorte: "2026-11-23", nota: "" }, HOY)).toThrow(/futura/);
    expect(() => validarSaldo({ saldo: "10", fechaCorte: "2026-02-30", nota: "" }, HOY)).toThrow(DisponibleInvalidoError);
  });
});
