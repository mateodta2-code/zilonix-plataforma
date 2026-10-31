import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, configuracionFinanzas, pedidoItems, pedidosFinanzas } from "@/db/schema";
import { crearCuentaMlDePrueba } from "@/db/test-utils/venta";
import { guardarConfiguracionFinanzas, guardarValorFlex, leerConfiguracionFinanzas } from "@/lib/configuracion-finanzas";
import { guardarCostoSku } from "@/lib/costos-sku";
import { guardarVentaFinanzas } from "@/lib/finanzas/guardar-venta";
import type { VentaMl } from "@/lib/finanzas/venta-ml";
import { MontoInvalidoError } from "@/lib/finanzas/montos";
import { SinPermisoError } from "@/lib/permisos";
import { crearEmpresaConPermisos } from "@/lib/test-utils/empresa-con-permiso";
import { guardarValorFlexAction } from "./actions";

// Issue #126 (slice urgente, Sharel 30-oct) — valor Flex por empresa,
// contra Postgres real. Solo se simula la sesión y la navegación de Next
// (redirect lanza; acá se captura la URL de destino).

vi.setConfig({ testTimeout: 20_000 });

const sesion = vi.hoisted(() => ({ usuarioId: "", empresaId: "" }));

vi.mock("@/lib/finanzas/contexto-accion", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/finanzas/contexto-accion")>();
  return { ...real, usuarioYEmpresaActiva: async () => ({ usuarioId: sesion.usuarioId, empresaId: sesion.empresaId }) };
});
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const MODIFICAR = [
  { modulo: "finanzas" as const, accion: "consultar" as const },
  { modulo: "finanzas" as const, accion: "modificar" as const },
];

async function enviar(flexValor: string): Promise<string> {
  const datos = new FormData();
  datos.set("flexValor", flexValor);
  try {
    await guardarValorFlexAction(datos);
  } catch (error) {
    const mensaje = (error as Error).message;
    if (mensaje.startsWith("REDIRECT:")) return decodeURIComponent(mensaje.slice("REDIRECT:".length));
    throw error;
  }
  throw new Error("la acción no redirigió");
}

function ventaFlex(sku: string, pedidoIdExterno = `orden-${randomUUID()}`): VentaMl {
  return {
    pedidoIdExterno,
    fecha: new Date("2026-10-28T15:00:00Z"),
    total: "120000.00",
    moneda: "COP",
    estado: "paid",
    formaEntrega: "flex",
    logisticTypeMl: "self_service",
    fechaPagoAprobado: new Date("2026-10-28T16:00:00Z"),
    valorVenta: "120000.00",
    reembolsos: "0.00",
    comisionMl: "14000.00",
    fleteMl: "0.00",
    cancelada: false,
    shipmentIdExterno: null,
    packIdExterno: null,
    fechaDespacho: null,
    fechaEntrega: null,
    lineas: [{ itemIdExterno: "MCO1", skuCodigo: sku, cantidad: 1, precioUnitario: "120000.00", titulo: "Secador Iónico", imagenUrl: null }],
  };
}

describe("valor Flex desde Finanzas → Configuración (issue #126)", () => {
  beforeEach(() => Object.assign(sesion, { usuarioId: "", empresaId: "" }));

  it("guarda «10.000» como 10000.00, deja bitácora y no pisa el resto de la configuración", async () => {
    const e = await crearEmpresaConPermisos("Flex guardar", MODIFICAR);
    await guardarConfiguracionFinanzas(e.empresaId, e.usuarioId, {
      flexValor: null,
      ivaPublicidad: "19.00",
      plazoVencimientoDias: 5,
      avisoDiasAntes: 2,
      avisoCorreoActivo: true,
      avisoWhatsappActivo: false,
      avisoCorreoDestino: "finanzas@ejemplo.com",
      avisoWhatsappDestino: null,
    });
    Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });

    const destino = await enviar("10.000");
    expect(destino).toContain("/panel/finanzas/configuracion?ok=");
    const config = await leerConfiguracionFinanzas(e.empresaId);
    expect(config).toMatchObject({
      flexValor: "10000.00",
      ivaPublicidad: "19.00",
      plazoVencimientoDias: 5,
      avisoDiasAntes: 2,
      avisoCorreoActivo: true,
      avisoCorreoDestino: "finanzas@ejemplo.com",
      actualizadaPor: e.usuarioId,
    });

    const bitacora = await dbComoEmpresa(e.empresaId, (tx) =>
      tx
        .select()
        .from(auditoria)
        .where(and(eq(auditoria.empresaId, e.empresaId), eq(auditoria.entidad, "configuracion_finanzas"), eq(auditoria.accion, "modificar")))
    );
    expect(bitacora).toHaveLength(1);
    expect(bitacora[0].valorAnterior).toContain("flex= ");
    // La bitácora guarda el valor como se envió (sin los ceros que pone
    // numeric(14,2) en la base).
    expect(bitacora[0].valorNuevo).toMatch(/^flex=10000 /);
  });

  it("sin fila de configuración la crea con el plazo por defecto", async () => {
    const e = await crearEmpresaConPermisos("Flex sin fila", MODIFICAR);
    Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
    expect(await enviar("$ 12000")).toContain("?ok=");
    expect(await leerConfiguracionFinanzas(e.empresaId)).toMatchObject({ flexValor: "12000.00", plazoVencimientoDias: 3, ivaPublicidad: null });
    // Lo que muestra el campo al volver («12.000») se puede guardar tal cual.
    expect(await enviar("12.000")).toContain("?ok=");
    expect(await enviar("$ 9.999,50")).toContain("?ok=");
    expect((await leerConfiguracionFinanzas(e.empresaId))?.flexValor).toBe("9999.50");
  });

  it("vacío, negativo o ambiguo: mensaje de error y no se guarda nada", async () => {
    const e = await crearEmpresaConPermisos("Flex inválido", MODIFICAR);
    Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
    for (const malo of ["", "-5000", "10,000", "abc"]) {
      expect(await enviar(malo)).toContain("?error=Valor Flex");
    }
    expect(await leerConfiguracionFinanzas(e.empresaId)).toBeNull();
  });

  it("rol solo con consultar: no guarda, ni por la acción ni llamando la función directo", async () => {
    const e = await crearEmpresaConPermisos("Flex solo consulta", [{ modulo: "finanzas", accion: "consultar" }]);
    Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
    await expect(enviar("10000")).rejects.toBeInstanceOf(SinPermisoError);
    await expect(guardarValorFlex(e.empresaId, e.usuarioId, "10000")).rejects.toBeInstanceOf(SinPermisoError);
    expect(await leerConfiguracionFinanzas(e.empresaId)).toBeNull();
  });

  it("A/B: el valor Flex de B no toca a A, y un usuario de B no puede guardar en A", async () => {
    const a = await crearEmpresaConPermisos("Flex A", MODIFICAR);
    const b = await crearEmpresaConPermisos("Flex B", MODIFICAR);
    await guardarValorFlex(a.empresaId, a.usuarioId, "10000");
    await guardarValorFlex(b.empresaId, b.usuarioId, "8000");
    expect((await leerConfiguracionFinanzas(a.empresaId))?.flexValor).toBe("10000.00");
    expect((await leerConfiguracionFinanzas(b.empresaId))?.flexValor).toBe("8000.00");
    await expect(guardarValorFlex(a.empresaId, b.usuarioId, "1")).rejects.toBeInstanceOf(SinPermisoError);
    // Directo a la función, un monto vacío tampoco pasa.
    await expect(guardarValorFlex(a.empresaId, a.usuarioId, "")).rejects.toBeInstanceOf(MontoInvalidoError);
    expect((await leerConfiguracionFinanzas(a.empresaId))?.flexValor).toBe("10000.00");
  });

  it("caso de Sharel: una venta Flex «sin costo» se congela al volver a traerla con el valor Flex guardado", async () => {
    const e = await crearEmpresaConPermisos("Flex secador", MODIFICAR);
    const cuenta = await crearCuentaMlDePrueba(e.empresaId);
    await guardarCostoSku({ empresaId: e.empresaId, usuarioId: e.usuarioId, skuCodigo: "SECADOR-ION", datos: { costo: "42900", empaque: "1500" } });
    const pedidoIdExterno = `orden-${randomUUID()}`;
    const r = await guardarVentaFinanzas(e.empresaId, cuenta, ventaFlex("SECADOR-ION", pedidoIdExterno));
    const leer = () =>
      dbComoEmpresa(e.empresaId, async (tx) => ({
        cabecera: (await tx.select().from(pedidosFinanzas).where(eq(pedidosFinanzas.pedidoId, r.pedidoId)))[0],
        linea: (await tx.select().from(pedidoItems).where(eq(pedidoItems.pedidoId, r.pedidoId)))[0],
      }));
    // Sin valor Flex: no se congela, ni el costo del producto.
    expect((await leer()).cabecera.congeladoTs).toBeNull();
    expect((await leer()).linea.costoCongelado).toBeNull();

    Object.assign(sesion, { usuarioId: e.usuarioId, empresaId: e.empresaId });
    await enviar("10.000");
    // «Traer ventas de este mes» vuelve a guardar la misma orden.
    await guardarVentaFinanzas(e.empresaId, cuenta, ventaFlex("SECADOR-ION", pedidoIdExterno));
    const despues = await leer();
    expect(despues.cabecera).toMatchObject({ estadoCosteo: "completo", envioAgenciaCongelado: "10000.00", empaqueCongelado: "1500.00" });
    expect(despues.cabecera.congeladoTs).not.toBeNull();
    expect(despues.linea.costoCongelado).toBe("42900.00");
    // Y una configuración de la empresa existe solo para ella.
    const filas = await dbComoEmpresa(e.empresaId, (tx) => tx.select().from(configuracionFinanzas).where(eq(configuracionFinanzas.empresaId, e.empresaId)));
    expect(filas).toHaveLength(1);
  });
});
