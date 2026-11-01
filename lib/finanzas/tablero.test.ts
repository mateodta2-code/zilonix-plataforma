import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, pedidos, pedidosFinanzas, publicidadMetricasDiarias } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { guardarCostoSku } from "@/lib/costos-sku";
import type { TotalesDetalle } from "./detalle-ventas";
import { guardarVentaFinanzas } from "./guardar-venta";
import {
  armarPublicidadMes,
  armarTableroPorCuenta,
  leerPublicidadMes,
  leerTableroMes,
  leerTableroPorCuenta,
  leerUtilidadMes,
  participacion,
  promedioDiario,
  resumirUtilidadMes,
  textoVariacion,
  tramosBogota,
  variacion,
} from "./tablero";
import type { VentaMl } from "./venta-ml";
import { listarVentasUtilidad } from "./ventas-consulta";
import { porcentajeVentasConCosto } from "./ventas-pantalla";

// Issue #163 (parte de #143) — tablero del mes de /panel/finanzas. La
// parte pura (tramos, promedio, variación) sin base; la consulta contra
// Postgres real, con RLS y el patrón A/B.

// Pasa cada llamada a la función real; solo se cuentan, para probar que
// el número de consultas no depende de cuántas cuentas haya.
vi.mock("@/db/empresa-context", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/db/empresa-context")>();
  return { ...real, dbComoEmpresa: vi.fn(real.dbComoEmpresa) };
});

vi.setConfig({ testTimeout: 30_000 });

const SOLO_CONSULTAR = [{ modulo: "finanzas" as const, accion: "consultar" as const }];

type Venta = { fecha: string; estado?: string; moneda?: string; valor?: string | null; cancelada?: boolean };

// Pedido y, salvo valor null (venta sin foto financiera), su cabecera.
async function crearVentas(empresaId: string, cuentaMlId: string, ventas: Venta[]): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    for (const v of ventas) {
      const [pedido] = await tx
        .insert(pedidos)
        .values({
          empresaId,
          cuentaMlId,
          pedidoIdExterno: `orden-${randomUUID()}`,
          fecha: new Date(v.fecha),
          // Distinto del valor_venta a propósito: el recaudo NO sale de acá.
          total: "1.00",
          moneda: v.moneda ?? "COP",
          estado: v.estado ?? "paid",
        })
        .returning({ id: pedidos.id });
      if (v.valor !== null) {
        await tx.insert(pedidosFinanzas).values({ empresaId, pedidoId: pedido.id, cuentaMlId, valorVenta: v.valor ?? "100000.00", cancelada: v.cancelada ?? false });
      }
    }
  });
}

describe("tramosBogota (issue #163)", () => {
  it("actual: día 1 hasta el fin de hoy en Bogotá; anterior: mismos días del mes anterior", () => {
    const { actual, anterior } = tramosBogota(new Date("2026-10-29T15:00:00Z"));
    expect(actual).toMatchObject({ desdeTexto: "2026-10-01", hastaTexto: "2026-10-29", dias: 29 });
    expect(actual.inicio.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(actual.finExclusivo.toISOString()).toBe("2026-10-30T05:00:00.000Z");
    expect(anterior).toMatchObject({ desdeTexto: "2026-09-01", hastaTexto: "2026-09-29", dias: 29 });
  });

  it("el mes anterior más corto se corta en su último día (también en bisiesto)", () => {
    expect(tramosBogota(new Date("2026-03-31T15:00:00Z")).anterior).toMatchObject({ hastaTexto: "2026-02-28", dias: 28 });
    expect(tramosBogota(new Date("2028-03-31T15:00:00Z")).anterior).toMatchObject({ hastaTexto: "2028-02-29", dias: 29 });
  });

  it("el día 1 es un tramo de 1 día, y enero compara contra diciembre del año anterior", () => {
    const { actual, anterior } = tramosBogota(new Date("2027-01-01T12:00:00Z"));
    expect(actual).toMatchObject({ desdeTexto: "2027-01-01", hastaTexto: "2027-01-01", dias: 1 });
    expect(anterior).toMatchObject({ desdeTexto: "2026-12-01", hastaTexto: "2026-12-01", dias: 1 });
  });

  it("el día lo pone Bogotá, no el servidor en UTC", () => {
    // 1-nov 03:00 UTC = 31-oct 22:00 en Bogotá.
    const { actual } = tramosBogota(new Date("2026-11-01T03:00:00Z"));
    expect(actual).toMatchObject({ desdeTexto: "2026-10-01", hastaTexto: "2026-10-31", dias: 31 });
  });
});

describe("promedioDiario y variacion (issue #163)", () => {
  it("promedio exacto con centavos, half-up", () => {
    expect(promedioDiario("100.00", 3)).toBe("33.33");
    expect(promedioDiario("49553680", 24)).toBe("2064736.67");
    expect(promedioDiario("0.00", 5)).toBe("0.00");
    expect(() => promedioDiario("100.00", 0)).toThrow();
  });

  it("variación con 1 decimal; anterior en 0 es null", () => {
    expect(variacion("110", "100")).toBe("10.0");
    expect(variacion("90", "100")).toBe("-10.0");
    expect(variacion("1", "3")).toBe("-66.7");
    expect(variacion("150000.50", "100000.25")).toBe("50.0");
    expect(variacion("5", "0")).toBeNull();
  });

  it("texto de pantalla: flecha, coma decimal y «—»", () => {
    expect(textoVariacion("10.4")).toBe("▲ 10,4 % vs. mismo tramo mes anterior");
    expect(textoVariacion("-3.0")).toBe("▼ 3,0 % vs. mismo tramo mes anterior");
    expect(textoVariacion("0.0")).toBe("= 0,0 % vs. mismo tramo mes anterior");
    expect(textoVariacion(null)).toBe("— vs. mismo tramo mes anterior");
    expect(textoVariacion("10.4", true)).toBe("— (mes anterior sin sincronizar)");
  });
});

describe("leerTableroMes (issue #163)", () => {
  // 31-oct 10:00 en Bogotá: actual 1–31 oct, anterior 1–30 sep.
  const AHORA = new Date("2026-10-31T15:00:00Z");

  it("cuenta ventas de pedidos y suma valor_venta por moneda, sin canceladas ni inválidas, con bordes de Bogotá", async () => {
    const a = await crearEmpresaConPermisos("Tablero A", SOLO_CONSULTAR);
    const cuenta1 = await crearCuentaMlDePrueba(a.empresaId);
    const cuenta2 = await crearCuentaMlDePrueba(a.empresaId);
    await crearVentas(a.empresaId, cuenta1, [
      // Actual
      { fecha: "2026-10-01T05:00:00Z", valor: "100000.00" }, // 1-oct 00:00 Bogotá
      { fecha: "2026-10-20T15:00:00Z", valor: "50000.50" },
      { fecha: "2026-10-21T15:00:00Z", valor: "99999.00", estado: "cancelled" },
      { fecha: "2026-10-22T15:00:00Z", valor: "88888.00", cancelada: true },
      { fecha: "2026-10-24T15:00:00Z", valor: null }, // sin foto: cuenta, no suma
      // Anterior
      { fecha: "2026-10-01T04:59:59Z", valor: "75000.25" }, // 30-sep 23:59 Bogotá
      { fecha: "2026-09-12T15:00:00Z", valor: "77777.00", estado: "invalid" },
      // Fuera de los dos tramos
      { fecha: "2026-08-31T15:00:00Z", valor: "1000.00" },
      { fecha: "2026-11-01T05:00:00Z", valor: "1000.00" },
    ]);
    await crearVentas(a.empresaId, cuenta2, [
      { fecha: "2026-10-23T15:00:00Z", moneda: "USD", valor: "50.00" },
      { fecha: "2026-09-10T15:00:00Z", valor: "25000.00" },
    ]);

    const t = await leerTableroMes(a.empresaId, a.usuarioId, AHORA);
    expect(t.tramo).toEqual({ desde: "2026-10-01", hasta: "2026-10-31", dias: 31 });
    expect(t.tramoAnterior).toEqual({ desde: "2026-09-01", hasta: "2026-09-30", dias: 30 });
    expect(t.ventas).toEqual({ actual: 4, anterior: 2, variacion: "100.0" });
    expect(t.sinSincronizar).toEqual({ actual: 1, anterior: 0 });
    expect(t.recaudo).toEqual([
      {
        moneda: "COP",
        actual: "150000.50",
        anterior: "100000.25",
        variacion: "50.0",
        promedioActual: "4838.73",
        promedioAnterior: "3333.34",
        variacionPromedio: "45.2",
      },
      { moneda: "USD", actual: "50.00", anterior: "0.00", variacion: null, promedioActual: "1.61", promedioAnterior: "0.00", variacionPromedio: null },
    ]);
    for (const r of t.recaudo) for (const v of [r.actual, r.anterior, r.promedioActual, r.promedioAnterior]) expect(typeof v).toBe("string");
  });

  it("con ventas sin sincronizar en el mes anterior no compara el recaudo, pero sí la cantidad", async () => {
    const e = await crearEmpresaConPermisos("Tablero anterior a medias", SOLO_CONSULTAR);
    const cuenta = await crearCuentaMlDePrueba(e.empresaId);
    await crearVentas(e.empresaId, cuenta, [
      { fecha: "2026-10-05T15:00:00Z", valor: "20000.00" },
      { fecha: "2026-10-06T15:00:00Z", valor: "20000.00" },
      { fecha: "2026-09-05T15:00:00Z", valor: "10000.00" },
      { fecha: "2026-09-06T15:00:00Z", valor: null },
    ]);
    const t = await leerTableroMes(e.empresaId, e.usuarioId, AHORA);
    expect(t.sinSincronizar).toEqual({ actual: 0, anterior: 1 });
    expect(t.ventas.variacion).toBe("0.0");
    expect(t.recaudo[0]).toMatchObject({ actual: "40000.00", anterior: "10000.00", variacion: null, variacionPromedio: null });
  });

  it("A/B: la empresa B no ve las ventas de A, y sin permiso o de otra empresa no se lee nada", async () => {
    const a = await crearEmpresaConPermisos("Tablero A/B — A", SOLO_CONSULTAR);
    const b = await crearEmpresaConPermisos("Tablero A/B — B", SOLO_CONSULTAR);
    await crearVentas(a.empresaId, await crearCuentaMlDePrueba(a.empresaId), [{ fecha: "2026-10-05T15:00:00Z", valor: "20000.00" }]);

    const deB = await leerTableroMes(b.empresaId, b.usuarioId, AHORA);
    expect(deB.ventas).toEqual({ actual: 0, anterior: 0, variacion: null });
    expect(deB.recaudo).toEqual([]);

    await expect(leerTableroMes(a.empresaId, b.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
    const sinFinanzas = await crearEmpresaConPermisos("Tablero sin finanzas", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(leerTableroMes(sinFinanzas.empresaId, sinFinanzas.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
  });

  it("el número de consultas no depende de cuántas cuentas tenga la empresa (2 vs 16)", async () => {
    const consultasCon = async (cuentas: number) => {
      const e = await crearEmpresaConPermisos(`Tablero ${cuentas} cuentas`, SOLO_CONSULTAR);
      for (let i = 0; i < cuentas; i++) {
        await crearVentas(e.empresaId, await crearCuentaMlDePrueba(e.empresaId), [{ fecha: "2026-10-05T15:00:00Z", valor: "1000.00" }]);
      }
      const espia = vi.mocked(dbComoEmpresa);
      espia.mockClear();
      const t = await leerTableroMes(e.empresaId, e.usuarioId, AHORA);
      expect(t.ventas.actual).toBe(cuentas);
      return espia.mock.calls.length;
    };
    const conDos = await consultasCon(2);
    const conDieciseis = await consultasCon(16);
    expect(conDieciseis).toBe(conDos);
  });
});

// ---------------------------------------------------------------------------
// Utilidad del mes antes de publicidad (siguiente parte de #143)
// ---------------------------------------------------------------------------

function totales(extra: Partial<TotalesDetalle>): TotalesDetalle {
  return {
    ventas: 0,
    ventas_sin_costo: 0,
    recaudo: "0.00",
    recaudo_sin_costo: "0.00",
    comision_ml: "0.00",
    flete_ml: "0.00",
    costo_producto: "0.00",
    empaque: "0.00",
    envio: "0.00",
    utilidad: "0.00",
    porcentaje_utilidad: null,
    porcentaje_ml: null,
    cantidad: 0,
    ...extra,
  };
}

describe("resumirUtilidadMes (#143)", () => {
  it("con ventas con y sin costo: la utilidad es la del detalle y el % sale de ventas-pantalla", () => {
    const r = resumirUtilidadMes(totales({ ventas: 3, ventas_sin_costo: 1, utilidad: "34000.00", recaudo_sin_costo: "50000.00" }), 0, ["COP"]);
    expect(r).toEqual({
      ventas: 3,
      ventasConCosto: 2,
      ventasSinCosto: 1,
      utilidad: "34000.00",
      recaudoSinCosto: "50000.00",
      porcentajeVentasConCosto: "66.67",
      rechazadas: 0,
      variasMonedas: false,
    });
    for (const v of [r.utilidad, r.recaudoSinCosto, r.porcentajeVentasConCosto]) expect(typeof v).toBe("string");
  });

  it("todas sin costo → «—» (null), no 0; el % es 0", () => {
    const r = resumirUtilidadMes(totales({ ventas: 2, ventas_sin_costo: 2, recaudo_sin_costo: "90000.00" }), 0, ["COP"]);
    expect(r).toMatchObject({ utilidad: null, porcentajeVentasConCosto: "0.00", ventasConCosto: 0 });
  });

  it("sin ventas → utilidad 0 y % «—»", () => {
    expect(resumirUtilidadMes(totales({}), 0, [])).toMatchObject({ ventas: 0, utilidad: "0.00", porcentajeVentasConCosto: null, variasMonedas: false });
  });

  it("varias monedas → null y variasMonedas; una moneda repetida no cuenta como varias", () => {
    const t = totales({ ventas: 2, utilidad: "17000.00" });
    expect(resumirUtilidadMes(t, 0, ["COP", "USD"])).toMatchObject({ utilidad: null, variasMonedas: true });
    expect(resumirUtilidadMes(t, 0, ["COP", "COP"])).toMatchObject({ utilidad: "17000.00", variasMonedas: false });
  });

  it("la utilidad negativa se conserva como texto, y cuenta las rechazadas", () => {
    expect(resumirUtilidadMes(totales({ ventas: 1, utilidad: "-1500.00" }), 2, ["COP"])).toMatchObject({ utilidad: "-1500.00", rechazadas: 2 });
  });
});

function ventaMl(fecha: string, extra: Partial<VentaMl> = {}): VentaMl {
  return {
    pedidoIdExterno: `orden-${randomUUID()}`,
    fecha: new Date(fecha),
    total: "50000.00",
    moneda: "COP",
    estado: "paid",
    formaEntrega: "agencia",
    logisticTypeMl: "cross_docking",
    fechaPagoAprobado: new Date(fecha),
    valorVenta: "50000.00",
    reembolsos: "0.00",
    comisionMl: "6000.00",
    fleteMl: "4000.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: null,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: "TAB-CON", cantidad: 1, precioUnitario: "50000.00", titulo: "Con costo", imagenUrl: null }],
    ...extra,
  };
}

const SIN_COSTO: Partial<VentaMl> = {
  lineas: [{ itemIdExterno: "MCO2", skuCodigo: "TAB-SIN", cantidad: 1, precioUnitario: "50000.00", titulo: "Sin costo", imagenUrl: null }],
};

const CONSULTAR_Y_MODIFICAR = [
  { modulo: "finanzas" as const, accion: "consultar" as const },
  { modulo: "finanzas" as const, accion: "modificar" as const },
];

// Empresa con el costo de TAB-CON cargado: 50.000 − 6.000 − 4.000 −
// 20.000 − 1.000 − 2.000 = 17.000 de utilidad por venta con costo.
async function empresaConCosto(nombre: string) {
  const e = await crearEmpresaConPermisos(nombre, CONSULTAR_Y_MODIFICAR);
  await guardarCostoSku({ empresaId: e.empresaId, usuarioId: e.usuarioId, skuCodigo: "TAB-CON", datos: { costo: "20000", empaque: "1000", envioAgencia: "2000" } });
  return e;
}

describe("leerUtilidadMes (#143)", () => {
  // 31-oct 10:00 en Bogotá: tramo actual 1–31 oct.
  const AHORA = new Date("2026-10-31T15:00:00Z");
  const { actual } = tramosBogota(AHORA);

  it("cuadra exacto con listarVentasUtilidad, suma varias cuentas y deja afuera canceladas, inválidas y bordes de Bogotá", async () => {
    const e = await empresaConCosto("Utilidad cuadre");
    const cuenta1 = await crearCuentaMlDePrueba(e.empresaId);
    const cuenta2 = await crearCuentaMlDePrueba(e.empresaId);
    for (const v of [
      ventaMl("2026-10-01T05:00:00Z"), // 1-oct 00:00 Bogotá: entra
      ventaMl("2026-10-10T15:00:00Z"),
      ventaMl("2026-10-11T15:00:00Z", SIN_COSTO),
      ventaMl("2026-10-12T15:00:00Z", { estado: "cancelled" }),
      ventaMl("2026-10-13T15:00:00Z", { estado: "invalid" }),
      ventaMl("2026-10-14T15:00:00Z", { cancelada: true }),
      ventaMl("2026-10-01T04:59:00Z"), // 30-sep 23:59 Bogotá: no entra
      ventaMl("2026-11-01T05:00:00Z"), // mañana: no entra
    ]) {
      await guardarVentaFinanzas(e.empresaId, cuenta1, v);
    }
    await guardarVentaFinanzas(e.empresaId, cuenta2, ventaMl("2026-10-20T15:00:00Z"));

    const u = await leerUtilidadMes(e.empresaId, e.usuarioId, AHORA, ["COP"]);
    expect(u).toEqual({
      ventas: 4,
      ventasConCosto: 3,
      ventasSinCosto: 1,
      utilidad: "51000.00",
      recaudoSinCosto: "50000.00",
      porcentajeVentasConCosto: "75.00",
      rechazadas: 0,
      variasMonedas: false,
    });

    const ventas = await listarVentasUtilidad(e.empresaId, e.usuarioId, { cuentaId: null, desde: actual.inicio, hastaExclusivo: actual.finExclusivo });
    expect(u.utilidad).toBe(ventas.detalle.total.utilidad);
    expect(u.porcentajeVentasConCosto).toBe(porcentajeVentasConCosto(ventas.detalle.total));
  });

  it("A/B: la utilidad de B no incluye ventas ni costos de A, y al revés", async () => {
    const a = await empresaConCosto("Utilidad A/B — A");
    const b = await crearEmpresaConPermisos("Utilidad A/B — B", CONSULTAR_Y_MODIFICAR);
    await guardarVentaFinanzas(a.empresaId, await crearCuentaMlDePrueba(a.empresaId), ventaMl("2026-10-05T15:00:00Z"));
    // B vende el mismo SKU pero no le cargó costo: el de A no le sirve.
    await guardarVentaFinanzas(b.empresaId, await crearCuentaMlDePrueba(b.empresaId), ventaMl("2026-10-06T15:00:00Z"));
    await guardarVentaFinanzas(b.empresaId, await crearCuentaMlDePrueba(b.empresaId), ventaMl("2026-10-07T15:00:00Z"));

    expect(await leerUtilidadMes(a.empresaId, a.usuarioId, AHORA, ["COP"])).toMatchObject({ ventas: 1, utilidad: "17000.00", porcentajeVentasConCosto: "100.00" });
    expect(await leerUtilidadMes(b.empresaId, b.usuarioId, AHORA, ["COP"])).toMatchObject({ ventas: 2, ventasSinCosto: 2, utilidad: null, porcentajeVentasConCosto: "0.00" });
  });

  it("sin finanzas.consultar, o con la empresa de otro, es SinPermisoError", async () => {
    const a = await empresaConCosto("Utilidad permiso A");
    const sinFinanzas = await crearEmpresaConPermisos("Utilidad sin finanzas", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(leerUtilidadMes(sinFinanzas.empresaId, sinFinanzas.usuarioId, AHORA, [])).rejects.toBeInstanceOf(SinPermisoError);
    await expect(leerUtilidadMes(a.empresaId, sinFinanzas.usuarioId, AHORA, [])).rejects.toBeInstanceOf(SinPermisoError);
  });
});

// ---------------------------------------------------------------------------
// Inicio: por cuenta y publicidad del mes (#143)
// ---------------------------------------------------------------------------

describe("armarPublicidadMes, armarTableroPorCuenta y participacion (#143)", () => {
  it("publicidad: sin filas es null (no 0); con filas suma en COP y ordena por gasto", () => {
    expect(armarPublicidadMes([])).toEqual({ totalPorMoneda: null, porCuenta: [] });
    const p = armarPublicidadMes([
      { cuentaMlId: "a", nickname: "FMC", costo: "120000.5" },
      { cuentaMlId: "b", nickname: "STORE", costo: "450000" },
      { cuentaMlId: "c", nickname: "OTRA", costo: "0" },
    ]);
    expect(p.totalPorMoneda).toEqual([{ moneda: "COP", monto: "570000.50" }]);
    expect(p.porCuenta.map((c) => [c.nickname, c.monto])).toEqual([
      ["STORE", "450000.00"],
      ["FMC", "120000.50"],
      ["OTRA", "0.00"],
    ]);
  });

  it("por cuenta: junta monedas, agrega cuentas que solo tienen publicidad y ordena por recaudo", () => {
    const filas = armarTableroPorCuenta(
      [
        { cuentaMlId: "a", nickname: "FMC", moneda: "COP", ventas: 3, recaudo: "90000.00" },
        { cuentaMlId: "b", nickname: "STORE", moneda: "USD", ventas: 1, recaudo: "50.00" },
        { cuentaMlId: "b", nickname: "STORE", moneda: "COP", ventas: 4, recaudo: "200000.00" },
      ],
      armarPublicidadMes([
        { cuentaMlId: "b", nickname: "STORE", costo: "30000" },
        { cuentaMlId: "z", nickname: "SOLO_ADS", costo: "1000" },
      ])
    );
    expect(filas).toEqual([
      {
        cuentaMlId: "b",
        nickname: "STORE",
        ventas: 5,
        recaudoPorMoneda: [
          { moneda: "COP", monto: "200000.00" },
          { moneda: "USD", monto: "50.00" },
        ],
        publicidad: "30000.00",
      },
      { cuentaMlId: "a", nickname: "FMC", ventas: 3, recaudoPorMoneda: [{ moneda: "COP", monto: "90000.00" }], publicidad: null },
      { cuentaMlId: "z", nickname: "SOLO_ADS", ventas: 0, recaudoPorMoneda: [], publicidad: "1000.00" },
    ]);
  });

  it("participación con 1 decimal", () => {
    expect(participacion(4, 7)).toBe("57.1");
    expect(participacion(3, 7)).toBe("42.9");
    expect(participacion(1, 1)).toBe("100.0");
    expect(participacion(0, 0)).toBe("0.0");
  });
});

describe("leerTableroPorCuenta y leerPublicidadMes (#143)", () => {
  // 31-oct 10:00 en Bogotá: tramo actual 1–31 oct.
  const AHORA = new Date("2026-10-31T15:00:00Z");

  async function cuentaConNombre(empresaId: string, nickname: string): Promise<string> {
    const id = await crearCuentaMlDePrueba(empresaId);
    await dbComoEmpresa(empresaId, (tx) => tx.update(cuentasMl).set({ nickname }).where(eq(cuentasMl.id, id)));
    return id;
  }

  async function publicidad(empresaId: string, cuentaMlId: string, filas: { fecha: string; costo: string; nivel?: "cuenta" | "campana"; campana?: string }[]) {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(publicidadMetricasDiarias).values(
        filas.map((f, i) => ({
          empresaId,
          cuentaMlId,
          nivel: f.nivel ?? ("campana" as const),
          entidadIdMl: f.nivel === "cuenta" ? "anunciante" : (f.campana ?? `campana-${i}`),
          fecha: f.fecha,
          costo: f.costo,
        }))
      )
    );
  }

  it("ventas y recaudo por cuenta con el criterio del tablero; publicidad solo nivel campaña (como /panel/publicidad) y del tramo", async () => {
    const e = await crearEmpresaConPermisos("Inicio por cuenta", SOLO_CONSULTAR);
    const store = await cuentaConNombre(e.empresaId, "STOREKINGSAS");
    const fmc = await cuentaConNombre(e.empresaId, "FMCBIENESTAR");
    await crearVentas(e.empresaId, store, [
      { fecha: "2026-10-01T05:00:00Z", valor: "100000.00" },
      { fecha: "2026-10-10T15:00:00Z", valor: "50000.00" },
      { fecha: "2026-10-11T15:00:00Z", valor: null }, // cuenta, no suma
      { fecha: "2026-10-12T15:00:00Z", valor: "99999.00", estado: "cancelled" },
      { fecha: "2026-09-30T15:00:00Z", valor: "77777.00" }, // mes anterior
    ]);
    await crearVentas(e.empresaId, fmc, [{ fecha: "2026-10-15T15:00:00Z", valor: "20000.00", cancelada: false }]);
    await publicidad(e.empresaId, store, [
      // Dos campañas el mismo día y otra al final del mes: se suman.
      { fecha: "2026-10-01", costo: "6000.00", campana: "c1" },
      { fecha: "2026-10-01", costo: "4000.00", campana: "c2" },
      { fecha: "2026-10-31", costo: "5000.50", campana: "c1" },
      { fecha: "2026-10-05", costo: "99999.00", nivel: "cuenta" }, // total de cuenta: no se suma
      { fecha: "2026-09-30", costo: "88888.00", campana: "c1" }, // fuera del tramo
    ]);

    const pub = await leerPublicidadMes(e.empresaId, e.usuarioId, AHORA);
    expect(pub).toEqual({
      totalPorMoneda: [{ moneda: "COP", monto: "15000.50" }],
      porCuenta: [{ cuentaMlId: store, nickname: "STOREKINGSAS", monto: "15000.50", moneda: "COP" }],
    });

    const filas = await leerTableroPorCuenta(e.empresaId, e.usuarioId, AHORA, pub);
    expect(filas).toEqual([
      { cuentaMlId: store, nickname: "STOREKINGSAS", ventas: 3, recaudoPorMoneda: [{ moneda: "COP", monto: "150000.00" }], publicidad: "15000.50" },
      { cuentaMlId: fmc, nickname: "FMCBIENESTAR", ventas: 1, recaudoPorMoneda: [{ moneda: "COP", monto: "20000.00" }], publicidad: null },
    ]);
    // Sin pasarle la publicidad, la lee sola y da lo mismo.
    expect(await leerTableroPorCuenta(e.empresaId, e.usuarioId, AHORA)).toEqual(filas);

    // Cuadra con el tablero: misma cantidad de ventas y mismo recaudo.
    const tablero = await leerTableroMes(e.empresaId, e.usuarioId, AHORA);
    expect(tablero.ventas.actual).toBe(4);
    expect(tablero.recaudo.map((r) => r.actual)).toEqual(["170000.00"]);
  });

  it("mes sin campañas: «Sin datos» (null), aunque haya un total de cuenta", async () => {
    const e = await crearEmpresaConPermisos("Inicio sin ads", SOLO_CONSULTAR);
    const c = await cuentaConNombre(e.empresaId, "SINADS");
    await publicidad(e.empresaId, c, [{ fecha: "2026-10-05", costo: "5000.00", nivel: "cuenta" }]);
    expect(await leerPublicidadMes(e.empresaId, e.usuarioId, AHORA)).toEqual({ totalPorMoneda: null, porCuenta: [] });
  });

  it("A/B y permiso: B no ve ventas ni publicidad de A; sin finanzas.consultar es SinPermisoError", async () => {
    const a = await crearEmpresaConPermisos("Inicio A/B — A", SOLO_CONSULTAR);
    const b = await crearEmpresaConPermisos("Inicio A/B — B", SOLO_CONSULTAR);
    const cuentaA = await cuentaConNombre(a.empresaId, "DE_A");
    await crearVentas(a.empresaId, cuentaA, [{ fecha: "2026-10-05T15:00:00Z", valor: "20000.00" }]);
    await publicidad(a.empresaId, cuentaA, [{ fecha: "2026-10-05", costo: "1000.00" }]);

    expect(await leerTableroPorCuenta(b.empresaId, b.usuarioId, AHORA)).toEqual([]);
    expect(await leerPublicidadMes(b.empresaId, b.usuarioId, AHORA)).toEqual({ totalPorMoneda: null, porCuenta: [] });

    const sinFinanzas = await crearEmpresaConPermisos("Inicio sin finanzas", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(leerTableroPorCuenta(sinFinanzas.empresaId, sinFinanzas.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
    await expect(leerPublicidadMes(sinFinanzas.empresaId, sinFinanzas.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
    await expect(leerPublicidadMes(a.empresaId, b.usuarioId, AHORA)).rejects.toBeInstanceOf(SinPermisoError);
  });
});
