import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidos, pedidosFinanzas } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { leerTableroMes, promedioDiario, textoVariacion, tramosBogota, variacion } from "./tablero";

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
