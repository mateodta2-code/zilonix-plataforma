import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, pedidoItems, pedidosFinanzas, ventasCorrecciones } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarCostoSku } from "@/lib/costos-sku";
import { guardarVentaFinanzas } from "@/lib/finanzas/guardar-venta";
import type { VentaMl } from "@/lib/finanzas/venta-ml";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { confirmarRecalculoAction, previsualizarRecalculoAction } from "./actions";

// Issue #131 (Parte C) — server actions del panel «Recalcular costo con
// la tabla maestra», contra Postgres real. Solo se simula la sesión (el
// contexto del panel lee Clerk y cookies) y revalidatePath; el permiso,
// RLS y el motor de recalcular-costos.ts son los reales.

vi.setConfig({ testTimeout: 20_000 });

const sesion = vi.hoisted(() => ({ usuarioId: "", empresaId: "" }));

vi.mock("@/lib/panel-contexto", () => ({
  obtenerContextoPanel: async () => ({ usuario: { id: sesion.usuarioId }, activa: { id: sesion.empresaId } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

function venta(sku: string, fecha = "2026-10-20T15:00:00Z"): VentaMl {
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
    fleteMl: "0.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: null,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: sku, cantidad: 1, precioUnitario: "50000.00", titulo: "Producto", imagenUrl: null }],
  };
}

const MODIFICAR = [
  { modulo: "finanzas" as const, accion: "consultar" as const },
  { modulo: "finanzas" as const, accion: "modificar" as const },
];

async function empresa(nombre: string, permisos = MODIFICAR) {
  const e = await crearEmpresaConPermisos(nombre, permisos);
  const cuentaMlId = await crearCuentaMlDePrueba(e.empresaId);
  const entrar = () => Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
  const leer = (pedidoId: string) =>
    dbComoEmpresa(e.empresaId, async (tx) => ({
      cabecera: (await tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, pedidoId)))[0],
      linea: (await tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, pedidoId)))[0],
    }));
  return { ...e, cuentaMlId, entrar, leer };
}

// El dueño de la maestra para cargar costos aunque la sesión sea otra.
function costo(e: { empresaId: string; usuarioId: string }, sku: string, datos: Parameters<typeof guardarCostoSku>[0]["datos"]) {
  return guardarCostoSku({ empresaId: e.empresaId, usuarioId: e.usuarioId, skuCodigo: sku, datos });
}

describe("recalcular costo desde Finanzas → Ventas (issue #131 Parte C)", () => {
  beforeEach(() => Object.assign(sesion, { usuarioId: "", empresaId: "" }));

  it("la vista previa no escribe; confirmar reescribe solo el costo, deja bitácora y respeta la corrección a mano", async () => {
    const e = await empresa("Recalculo action");
    await costo(e, "REC-A", { costo: "10000", empaque: "1000", envioAgencia: "2000" });
    const uno = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("REC-A"));
    const corregida = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("REC-A"));
    await dbComoEmpresa(e.empresaId, (tx) =>
      tx
        .insert(ventasCorrecciones)
        .values({ empresaId: e.empresaId, pedidoId: corregida.pedidoId, linea: 1, campo: "costo_producto", valorNuevo: "9000", nota: "Factura", creadoPor: e.usuarioId })
    );
    await costo(e, "REC-A", { costo: "12000", empaque: "4000", envioAgencia: "8000" });
    e.entrar();

    const vista = await previsualizarRecalculoAction({ skuCodigo: " rec-a ", desde: "", hasta: "" });
    expect(vista).toMatchObject({
      ok: true,
      cambios: [{ pedidoId: uno.pedidoId, linea: 1, skuCodigo: "REC-A", antes: "10000.00", despues: "12000.00", origen: "exacto" }],
      omitidos: [{ pedidoId: corregida.pedidoId, linea: 1, motivo: "correccion_manual" }],
      filtro: { skuCodigo: "rec-a" },
    });
    // Sin confirmar, nada cambió.
    expect((await e.leer(uno.pedidoId)).linea.costoCongelado).toBe("10000.00");
    if (!vista.ok) throw new Error("vista");

    const r = await confirmarRecalculoAction({ skuCodigo: " rec-a ", vistos: vista.cambios });
    expect(r).toEqual({ ok: true, ventas: 1, lineas: 1 });
    const despues = await e.leer(uno.pedidoId);
    expect(despues.linea.costoCongelado).toBe("12000.00");
    expect(despues.cabecera).toMatchObject({ empaqueCongelado: "1000.00", envioAgenciaCongelado: "2000.00" });
    expect((await e.leer(corregida.pedidoId)).linea.costoCongelado).toBe("10000.00");

    const bitacora = await dbComoEmpresa(e.empresaId, (tx) =>
      tx.select().from(auditoria).where(and(eq(auditoria.empresaId, e.empresaId), eq(auditoria.accion, "recalcular_costo_congelado")))
    );
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0]).toMatchObject({ entidadId: uno.pedidoId, usuarioId: e.usuarioId, actorTipo: "persona" });
  });

  it("combo: filtrar por BASE trae BASEX2 con origen combo_base; por rango de días de Bogotá también", async () => {
    const e = await empresa("Recalculo action combo");
    await costo(e, "BASE", { costo: "10000", empaque: "1000", envioAgencia: "2000" });
    const combo = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("BASEX2", "2026-10-20T15:00:00Z"));
    // 21-oct 00:30 en Bogotá: fuera de un «Hasta» 2026-10-20.
    await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("BASEX2", "2026-10-21T05:30:00Z"));
    await costo(e, "BASE", { costo: "15000" });
    e.entrar();

    const porSku = await previsualizarRecalculoAction({ skuCodigo: "BASE" });
    expect(porSku).toMatchObject({ ok: true });
    if (!porSku.ok) throw new Error("vista");
    expect(porSku.cambios.map((c) => [c.skuCodigo, c.antes, c.despues, c.origen])).toEqual([
      ["BASEX2", "20000.00", "30000.00", "combo_base"],
      ["BASEX2", "20000.00", "30000.00", "combo_base"],
    ]);

    const porDia = await previsualizarRecalculoAction({ desde: "2026-10-20", hasta: "2026-10-20" });
    if (!porDia.ok) throw new Error("vista");
    expect(porDia.cambios.map((c) => c.pedidoId)).toEqual([combo.pedidoId]);
    expect(porDia.filtro).toMatchObject({ desdeIso: "2026-10-20T05:00:00.000Z", hastaIso: "2026-10-21T05:00:00.000Z" });
  });

  it("desactualizado: si la maestra cambia entre la vista y la confirmación, no escribe nada y trae la vista nueva", async () => {
    const e = await empresa("Recalculo action desactualizado");
    await costo(e, "REC-D", { costo: "100" });
    const a = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("REC-D"));
    const b = await guardarVentaFinanzas(e.empresaId, e.cuentaMlId, venta("REC-D"));
    await costo(e, "REC-D", { costo: "200" });
    e.entrar();

    const vista = await previsualizarRecalculoAction({ skuCodigo: "REC-D" });
    if (!vista.ok) throw new Error("vista");
    expect(vista.cambios).toHaveLength(2);
    await costo(e, "REC-D", { costo: "300" });

    const r = await confirmarRecalculoAction({ skuCodigo: "REC-D", vistos: vista.cambios });
    expect(r).toMatchObject({ ok: false, lineas: ["Los costos cambiaron desde la vista previa. Mira de nuevo y confirma otra vez."] });
    if (r.ok || !r.vista) throw new Error("sin vista nueva");
    expect(r.vista.cambios.map((c) => c.despues)).toEqual(["300.00", "300.00"]);
    expect((await e.leer(a.pedidoId)).linea.costoCongelado).toBe("100.00");
    expect((await e.leer(b.pedidoId)).linea.costoCongelado).toBe("100.00");
  });

  it("rol solo con consultar: mensaje de rol, sin escribir (ni llamando a la action directo)", async () => {
    const duena = await empresa("Recalculo action permiso");
    await costo(duena, "REC-P", { costo: "100" });
    const v = await guardarVentaFinanzas(duena.empresaId, duena.cuentaMlId, venta("REC-P"));
    await costo(duena, "REC-P", { costo: "200" });

    const consulta = await crearEmpresaConPermisos("Recalculo solo consulta", [{ modulo: "finanzas", accion: "consultar" }]);
    Object.assign(sesion, { usuarioId: consulta.usuarioId, empresaId: consulta.empresaId });
    expect(await previsualizarRecalculoAction({ skuCodigo: "REC-P" })).toEqual({ ok: false, lineas: ["Tu rol no puede recalcular costos."] });
    // Aunque mande la empresa de otro con cambios armados a mano.
    Object.assign(sesion, { usuarioId: consulta.usuarioId, empresaId: duena.empresaId });
    const directo = await confirmarRecalculoAction({
      skuCodigo: "REC-P",
      vistos: [{ pedidoId: v.pedidoId, linea: 1, antes: "100.00", despues: "200.00" }],
    });
    expect(directo).toEqual({ ok: false, lineas: ["Tu rol no puede recalcular costos."] });
    expect((await duena.leer(v.pedidoId)).linea.costoCongelado).toBe("100.00");
  });

  it("A/B: la empresa B no ve ni cambia las ventas de A", async () => {
    const a = await empresa("Recalculo action A");
    const b = await empresa("Recalculo action B");
    await costo(a, "REC-AB", { costo: "100" });
    const deA = await guardarVentaFinanzas(a.empresaId, a.cuentaMlId, venta("REC-AB"));
    await costo(a, "REC-AB", { costo: "200" });
    await costo(b, "REC-AB", { costo: "999" });

    b.entrar();
    const vistaB = await previsualizarRecalculoAction({ skuCodigo: "REC-AB" });
    expect(vistaB).toMatchObject({ ok: true, cambios: [], omitidos: [] });
    // B confirma con el cambio de A armado a mano: no coincide con su vista y no escribe.
    const r = await confirmarRecalculoAction({ skuCodigo: "REC-AB", vistos: [{ pedidoId: deA.pedidoId, linea: 1, antes: "100.00", despues: "200.00" }] });
    expect(r.ok).toBe(false);
    expect((await a.leer(deA.pedidoId)).linea.costoCongelado).toBe("100.00");
  });

  it("filtro vacío: mensaje claro, sin llamar al motor", async () => {
    const e = await empresa("Recalculo action vacio");
    e.entrar();
    expect(await previsualizarRecalculoAction({ skuCodigo: "  ", desde: "", hasta: "" })).toEqual({
      ok: false,
      lineas: ["Elige un SKU o un rango de fechas para recalcular."],
    });
    expect(await confirmarRecalculoAction({ vistos: [] })).toEqual({ ok: false, lineas: ["Elige un SKU o un rango de fechas para recalcular."] });
  });
});
