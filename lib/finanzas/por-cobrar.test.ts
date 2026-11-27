import { describe, expect, it } from "vitest";
import {
  agruparPorCuenta,
  aDiezmilesimas,
  emparejarCuentasMp,
  estadoVisiblePartida,
  aTextoMonto,
  esEstadoFalabellaPorCobrar,
  estaVencida,
  extraerFechaProgramadaFalabella,
  filtrarPartidas,
  leerFiltrosPorCobrar,
  ordenarPartidas,
  resumirPorMoneda,
  ventanasBogota,
  type PartidaPorCobrar,
} from "./por-cobrar";

// Issue #422 — cálculo puro de cuentas por cobrar.

const CUENTA_ML = "11111111-1111-4111-8111-111111111111";
const CUENTA_MX = "22222222-2222-4222-8222-222222222222";
const CUENTA_FAL = "33333333-3333-4333-8333-333333333333";

function partida(extra: Partial<PartidaPorCobrar>): PartidaPorCobrar {
  return {
    marketplace: "ml",
    fuente: "ventas",
    retenido: false,
    cuentaId: CUENTA_ML,
    cuenta: "TIENDA_CO",
    moneda: "COP",
    referencia: "2000001",
    estado: "pending",
    fechaEsperada: "2026-11-21",
    monto: "100000.00",
    ...extra,
  };
}

// Jueves 19-nov-2026, 22:00 de Bogotá (ya viernes en UTC).
const AHORA = new Date("2026-11-20T03:00:00Z");

describe("ventanasBogota", () => {
  it("usa el día de Bogotá, la semana hasta el domingo y el mes siguiente completo", () => {
    expect(ventanasBogota(AHORA)).toEqual({
      hoy: "2026-11-19",
      semana: { desde: "2026-11-19", hasta: "2026-11-22" },
      proximoMes: { desde: "2026-12-01", hasta: "2026-12-31" },
    });
  });

  it("un domingo, la semana es solo ese día; en diciembre el próximo mes es enero", () => {
    const v = ventanasBogota(new Date("2026-12-27T15:00:00Z"));
    expect(v.semana).toEqual({ desde: "2026-12-27", hasta: "2026-12-27" });
    expect(v.proximoMes).toEqual({ desde: "2027-01-01", hasta: "2027-01-31" });
  });
});

describe("montos", () => {
  it("lee hasta 4 decimales y redondea a 2 lejos de cero", () => {
    expect(aTextoMonto(aDiezmilesimas("117830.9400"))).toBe("117830.94");
    expect(aTextoMonto(aDiezmilesimas("10.005"))).toBe("10.01");
    expect(aTextoMonto(aDiezmilesimas("-10.005"))).toBe("-10.01");
    expect(aTextoMonto(aDiezmilesimas("-0.0001"))).toBe("0.00");
    expect(() => aDiezmilesimas("1.000,50")).toThrow();
  });
});

describe("resumirPorMoneda", () => {
  const partidas = [
    partida({ fechaEsperada: "2026-11-21", monto: "100000.00" }),
    partida({ referencia: "2000002", fechaEsperada: "2026-12-15", monto: "50000.50" }),
    partida({ referencia: "2000003", fechaEsperada: "2027-01-05", monto: "1000.00" }),
    partida({ marketplace: "falabella", cuentaId: CUENTA_FAL, cuenta: "FALA", referencia: "EC-1", fechaEsperada: null, monto: "117830.9400" }),
    partida({ cuentaId: CUENTA_MX, cuenta: "TIENDA_MX", moneda: "MXN", fechaEsperada: "2026-11-20", monto: "300.00" }),
  ];

  it("separa por moneda y reparte semana, próximo mes y sin fecha", () => {
    expect(resumirPorMoneda(partidas, ventanasBogota(AHORA))).toEqual([
      { moneda: "COP", partidas: 4, total: "268831.44", porLiberar: "268831.44", retenido: "0.00", estaSemana: "100000.00", proximoMes: "50000.50", sinFecha: "117830.94", vencido: "0.00", sinNeto: 0 },
      { moneda: "MXN", partidas: 1, total: "300.00", porLiberar: "300.00", retenido: "0.00", estaSemana: "300.00", proximoMes: "0.00", sinFecha: "0.00", vencido: "0.00", sinNeto: 0 },
    ]);
  });

  it("una fecha ya pasada se marca vencida y va aparte de esta semana (no se esconde)", () => {
    const v = ventanasBogota(AHORA);
    const vieja = partida({ fechaEsperada: "2026-11-10" });
    expect(estaVencida(vieja, v)).toBe(true);
    expect(estaVencida(partida({ fechaEsperada: "2026-11-19" }), v)).toBe(false);
    const [cop] = resumirPorMoneda([vieja], v);
    expect(cop).toMatchObject({ total: "100000.00", vencido: "100000.00", estaSemana: "0.00" });
  });

  it("una pendiente sin neto cuenta como partida pero no suma montos", () => {
    const [cop] = resumirPorMoneda([partida({}), partida({ referencia: "2000009", monto: null })], ventanasBogota(AHORA));
    expect(cop).toMatchObject({ partidas: 2, sinNeto: 1, total: "100000.00", estaSemana: "100000.00" });
  });

  it("agrupa por plataforma, cuenta y moneda, con la próxima fecha", () => {
    const filas = agruparPorCuenta(partidas, ventanasBogota(AHORA));
    expect(filas.map((f) => [f.marketplace, f.cuenta, f.moneda, f.partidas, f.proximaFecha, f.total])).toEqual([
      ["ml", "TIENDA_CO", "COP", 3, "2026-11-21", "151000.50"],
      ["ml", "TIENDA_MX", "MXN", 1, "2026-11-20", "300.00"],
      ["falabella", "FALA", "COP", 1, null, "117830.94"],
    ]);
  });

  it("ordena el detalle por fecha y deja lo sin fecha al final", () => {
    expect(ordenarPartidas(partidas).map((p) => p.fechaEsperada)).toEqual(["2026-11-20", "2026-11-21", "2026-12-15", "2027-01-05", null]);
  });
});

describe("filtros", () => {
  it("solo acepta marketplaces conocidos y cuentas con forma de uuid", () => {
    expect(leerFiltrosPorCobrar({ marketplace: "falabella", cuenta: CUENTA_FAL })).toEqual({ marketplace: "falabella", cuentaId: CUENTA_FAL });
    expect(leerFiltrosPorCobrar({ marketplace: "amazon", cuenta: "1; drop table" })).toEqual({ marketplace: null, cuentaId: null });
    expect(leerFiltrosPorCobrar({ marketplace: ["ml", "falabella"] })).toEqual({ marketplace: null, cuentaId: null });
  });

  it("filtra por marketplace y por tienda", () => {
    const lista = [partida({}), partida({ marketplace: "falabella", cuentaId: CUENTA_FAL })];
    expect(filtrarPartidas(lista, { marketplace: "falabella", cuentaId: null })).toHaveLength(1);
    expect(filtrarPartidas(lista, { marketplace: null, cuentaId: CUENTA_ML })).toHaveLength(1);
    expect(filtrarPartidas(lista, { marketplace: null, cuentaId: null })).toHaveLength(2);
  });
});

describe("estados de Falabella", () => {
  it("acepta los estados por cobrar, también «Programado para AAAA-MM-DD»", () => {
    for (const e of ["Abierto", "Procesando cierre", "Pago programado", "Programado para 2026-11-26", "  programado PARA 2026-11-26 ", "ABIERTO"]) {
      expect(esEstadoFalabellaPorCobrar(e)).toBe(true);
    }
  });

  it("rechaza lo pagado, lo no pagado y lo vacío", () => {
    for (const e of ["Pagado", "No pagado", "", "   ", null]) {
      expect(esEstadoFalabellaPorCobrar(e)).toBe(false);
    }
  });

  it("extrae la fecha programada válida", () => {
    expect(extraerFechaProgramadaFalabella(["Programado para 2026-11-26"])).toBe("2026-11-26");
  });

  it("descarta fechas calendario inválidas", () => {
    expect(extraerFechaProgramadaFalabella(["Programado para 2026-02-30"])).toBeNull();
    expect(extraerFechaProgramadaFalabella(["Programado para 2026-13-01"])).toBeNull();
  });

  it("sin fecha programada devuelve null", () => {
    expect(extraerFechaProgramadaFalabella(["Abierto", "Procesando cierre", null])).toBeNull();
    expect(extraerFechaProgramadaFalabella([])).toBeNull();
  });

  it("con varias fechas devuelve la más próxima", () => {
    expect(
      extraerFechaProgramadaFalabella(["Programado para 2026-12-10", "Abierto", "Programado para 2026-11-26", "Programado para 2026-02-30"])
    ).toBe("2026-11-26");
  });
});

describe("Mercado Pago: retenido y estado visible", () => {
  const v = ventanasBogota(AHORA);

  it("lo retenido suma al total y a «retenido», nunca a semana, mes, vencido ni sin fecha", () => {
    const lista = [
      partida({ fuente: "mp", fechaEsperada: "2026-11-21", monto: "100000.00" }),
      partida({ fuente: "mp", referencia: "P-2", retenido: true, fechaEsperada: "2026-11-10", monto: "25000.25" }),
      partida({ fuente: "mp", referencia: "P-3", retenido: true, fechaEsperada: null, monto: "0.10" }),
    ];
    const [cop] = resumirPorMoneda(lista, v);
    expect(cop).toMatchObject({
      partidas: 3,
      total: "125000.35",
      porLiberar: "100000.00",
      retenido: "25000.35",
      estaSemana: "100000.00",
      vencido: "0.00",
      sinFecha: "0.00",
    });
    expect(agruparPorCuenta(lista, v)[0]).toMatchObject({ total: "125000.35", retenido: "25000.35" });
  });

  it("muestra «Por liberar», «Vencido» o «Retenido (reclamo)» en ML; Falabella conserva su estado", () => {
    expect(estadoVisiblePartida(partida({ fuente: "mp", estado: "approved" }), v)).toBe("Por liberar");
    expect(estadoVisiblePartida(partida({ fuente: "mp", fechaEsperada: "2026-11-01" }), v)).toBe("Vencido");
    expect(estadoVisiblePartida(partida({ fuente: "mp", retenido: true, fechaEsperada: "2026-11-01" }), v)).toBe("Retenido (reclamo)");
    expect(estadoVisiblePartida(partida({ marketplace: "falabella", fuente: "falabella", estado: "Abierto" }), v)).toBe("Abierto");
  });
});

describe("emparejarCuentasMp (sin doble conteo)", () => {
  const CUENTA_MP = "44444444-4444-4444-8444-444444444444";
  const CUENTA_MP_SOLA = "55555555-5555-4555-8555-555555555555";
  const cuentasMl = [
    { id: CUENTA_ML, cuentaIdExterna: "111", nickname: "TIENDA_CO" },
    { id: CUENTA_MX, cuentaIdExterna: "222", nickname: "TIENDA_MX" },
  ];

  it("la cuenta ML con MP sincronizado usa los pagos de MP y omite pedidos_finanzas; las demás siguen con el estimado", () => {
    const { reemplazadas, destinoMp } = emparejarCuentasMp(cuentasMl, [
      { id: CUENTA_MP, cuentaIdExterna: "111", nickname: "MP_CO" },
      { id: CUENTA_MP_SOLA, cuentaIdExterna: "999", nickname: null },
    ]);
    expect([...reemplazadas]).toEqual([CUENTA_ML]);
    expect(destinoMp.get(CUENTA_MP)).toEqual({ cuentaId: CUENTA_ML, cuenta: "TIENDA_CO" });
    expect(destinoMp.get(CUENTA_MP_SOLA)).toEqual({ cuentaId: CUENTA_MP_SOLA, cuenta: "999" });

    const estimado = [
      partida({ referencia: "2000001", monto: "100000.00" }),
      partida({ cuentaId: CUENTA_MX, cuenta: "TIENDA_MX", moneda: "MXN", referencia: "3000001", monto: "300.00" }),
    ].filter((p) => !reemplazadas.has(p.cuentaId));
    const deMp = [
      partida({ fuente: "mp", cuentaId: destinoMp.get(CUENTA_MP)!.cuentaId, referencia: "2000001 (pago 9)", monto: "95000.00" }),
    ];
    const totales = resumirPorMoneda([...estimado, ...deMp], ventanasBogota(AHORA));
    // La misma venta no se cuenta dos veces: solo el neto de Mercado Pago.
    expect(totales.find((t) => t.moneda === "COP")).toMatchObject({ partidas: 1, total: "95000.00" });
    expect(totales.find((t) => t.moneda === "MXN")).toMatchObject({ partidas: 1, total: "300.00" });
  });

  it("sin cuentas MP sincronizadas no reemplaza nada", () => {
    expect(emparejarCuentasMp(cuentasMl, []).reemplazadas.size).toBe(0);
  });
});
