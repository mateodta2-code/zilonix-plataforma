import { randomUUID } from "crypto";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicidadMetricasDiarias } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarConfiguracionFinanzas } from "@/lib/configuracion-finanzas";
import { guardarCostoSku } from "@/lib/costos-sku";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { guardarVentaFinanzas } from "./guardar-venta";
import { conIva, leerIndicadores, restar, ticketPromedio, tramoDeFechas, tramoDeHoy } from "./indicadores";
import { avanceMeta, diasDelMes } from "./meta-avance";
import { listarVentasUtilidad } from "./ventas-consulta";
import type { VentaMl } from "./venta-ml";

// Inicio (13-nov) — indicadores por tramo y avance de la meta. La parte
// pura sin base; la lectura contra Postgres real.

describe("tramos de Inicio", () => {
  it("rango de días de Bogotá con «hasta» incluido; máximo 31 días", () => {
    const r = tramoDeFechas("2026-11-01", "2026-11-13");
    expect(r).toMatchObject({ tramo: { desdeTexto: "2026-11-01", hastaTexto: "2026-11-13", dias: 13 } });
    if ("tramo" in r) expect(r.tramo.inicio.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(tramoDeFechas("2026-10-01", "2026-11-13")).toMatchObject({ error: expect.stringContaining("31 días") });
    expect(tramoDeFechas("2026-11-10", "2026-11-01")).toMatchObject({ error: expect.stringContaining("anterior") });
    expect(tramoDeFechas("13/11/2026", "2026-11-13")).toMatchObject({ error: expect.any(String) });
  });

  it("hoy es el día de Bogotá, no el de UTC", () => {
    // 14-nov 03:00 UTC = 13-nov 22:00 en Bogotá.
    expect(tramoDeHoy(new Date("2026-11-14T03:00:00Z"))).toMatchObject({ desdeTexto: "2026-11-13", hastaTexto: "2026-11-13", dias: 1 });
  });
});

describe("cuentas de Inicio (puras)", () => {
  it("IVA de publicidad, ticket promedio y resta, en centavos exactos", () => {
    expect(conIva("100000.00", "19.00")).toBe("119000.00");
    expect(conIva("33.33", "19.00")).toBe("39.66");
    expect(conIva("100000.00", null)).toBe("100000.00");
    expect(ticketPromedio("100.00", 3)).toBe("33.33");
    expect(ticketPromedio("100.00", 0)).toBeNull();
    expect(restar("50000.00", "60000.50")).toBe("-10000.50");
  });

  it("avance de la meta: %, faltante, ritmos y proyección por regla de tres", () => {
    const a = avanceMeta({ meta: "31000000", logrado: "13000000", diasTranscurridos: 13, diasMes: 30 });
    expect(a).toMatchObject({
      porcentaje: "41.9",
      porcentajeBarra: 41,
      faltante: "18000000.00",
      diasRestantes: 17,
      ritmoActual: "1000000.00",
      ritmoNecesario: "1058823.53",
      proyeccion: "30000000.00",
    });
  });

  it("meta cumplida, utilidad negativa y meta en 0", () => {
    expect(avanceMeta({ meta: "100", logrado: "150", diasTranscurridos: 10, diasMes: 30 })).toMatchObject({
      porcentaje: "150.0",
      porcentajeBarra: 100,
      faltante: "0.00",
      ritmoNecesario: null,
    });
    expect(avanceMeta({ meta: "100", logrado: "-20", diasTranscurridos: 10, diasMes: 30 })).toMatchObject({ porcentaje: "-20.0", porcentajeBarra: 0 });
    expect(avanceMeta({ meta: "0", logrado: "10", diasTranscurridos: 1, diasMes: 30 })).toMatchObject({ porcentaje: null });
    expect(diasDelMes("2028-02-01")).toBe(29);
  });
});

function venta(fecha: string, sku: string): VentaMl {
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
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: sku, cantidad: 1, precioUnitario: "50000.00", titulo: "Producto", imagenUrl: null }],
  };
}

describe("leerIndicadores (contra Postgres)", () => {
  it("ventas, recaudo, ticket, utilidad, margen, publicidad con IVA y utilidad después de publicidad; cuadra con Finanzas → Ventas", async () => {
    const e = await crearEmpresaConPermisos("Indicadores", [
      { modulo: "finanzas", accion: "consultar" },
      { modulo: "finanzas", accion: "modificar" },
    ]);
    const cuenta = await crearCuentaMlDePrueba(e.empresaId);
    // 50.000 − 6.000 − 4.000 − 20.000 − 1.000 − 2.000 = 17.000 por venta con costo.
    await guardarCostoSku({ empresaId: e.empresaId, usuarioId: e.usuarioId, skuCodigo: "IND-1", datos: { costo: "20000", empaque: "1000", envioAgencia: "2000" } });
    await guardarVentaFinanzas(e.empresaId, cuenta, venta("2026-11-03T15:00:00Z", "IND-1"));
    await guardarVentaFinanzas(e.empresaId, cuenta, venta("2026-11-04T15:00:00Z", "IND-1"));
    await guardarVentaFinanzas(e.empresaId, cuenta, venta("2026-11-05T15:00:00Z", "SIN-COSTO"));
    await guardarVentaFinanzas(e.empresaId, cuenta, venta("2026-10-31T15:00:00Z", "IND-1")); // fuera
    await dbComoEmpresa(e.empresaId, (tx) =>
      tx.insert(publicidadMetricasDiarias).values([
        { empresaId: e.empresaId, cuentaMlId: cuenta, nivel: "campana", entidadIdMl: "c1", fecha: "2026-11-03", costo: "8000.00" },
        { empresaId: e.empresaId, cuentaMlId: cuenta, nivel: "campana", entidadIdMl: "c2", fecha: "2026-11-04", costo: "2000.00" },
      ])
    );
    await guardarConfiguracionFinanzas(e.empresaId, e.usuarioId, {
      flexValor: null,
      ivaPublicidad: "19.00",
      plazoVencimientoDias: 3,
      avisoDiasAntes: null,
      avisoCorreoActivo: null,
      avisoWhatsappActivo: null,
      avisoCorreoDestino: null,
      avisoWhatsappDestino: null,
    });

    const r = tramoDeFechas("2026-11-01", "2026-11-13");
    if (!("tramo" in r)) throw new Error("tramo");
    const ind = await leerIndicadores(e.empresaId, e.usuarioId, r.tramo);
    expect(ind).toMatchObject({
      tramo: { desde: "2026-11-01", hasta: "2026-11-13", dias: 13 },
      ventas: 3,
      sinSincronizar: 0,
      recaudo: [{ moneda: "COP", monto: "150000.00", ventasSincronizadas: 3, ticketPromedio: "50000.00" }],
      utilidad: { utilidad: "34000.00", ventasConCosto: 2, ventasSinCosto: 1 },
      margen: "34.00",
      publicidad: { costo: "10000.00", iva: "19.00", descontado: "11900.00" },
      utilidadDespues: "22100.00",
    });
    expect(ind.porCuenta).toHaveLength(1);

    // Misma utilidad y margen que Finanzas → Ventas en ese rango.
    const ventas = await listarVentasUtilidad(e.empresaId, e.usuarioId, { cuentaId: null, desde: r.tramo.inicio, hastaExclusivo: r.tramo.finExclusivo });
    expect(ind.utilidad.utilidad).toBe(ventas.detalle.total.utilidad);
    expect(ind.margen).toBe(ventas.detalle.total.porcentaje_utilidad);
  });

  it("sin publicidad se resta $0 y lo dice (costo null); sin permiso no se lee", async () => {
    const e = await crearEmpresaConPermisos("Indicadores sin ads", [{ modulo: "finanzas", accion: "consultar" }]);
    const ind = await leerIndicadores(e.empresaId, e.usuarioId, tramoDeHoy(new Date()));
    expect(ind).toMatchObject({ ventas: 0, recaudo: [], publicidad: { costo: null, descontado: "0.00" }, utilidadDespues: "0.00" });

    const sin = await crearEmpresaConPermisos("Indicadores sin permiso", [{ modulo: "ventas", accion: "consultar" }]);
    await expect(leerIndicadores(sin.empresaId, sin.usuarioId, tramoDeHoy(new Date()))).rejects.toBeInstanceOf(SinPermisoError);
  });
});
