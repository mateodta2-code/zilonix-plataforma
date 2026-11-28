"use server";

import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { GastoInvalidoError } from "@/lib/finanzas/gastos";
import { GastoNoEncontradoError, marcarGastoPagado } from "@/lib/finanzas/gastos-db";
import { marcarOrdenCompraPagada, marcarVentasPagadas, OrdenCompraNoEncontradaError, PartidaVentasNoPendienteError } from "@/lib/finanzas/por-pagar-db";
import { requierePermiso } from "@/lib/permisos";

// Issue #422 (fase 5 de Finanzas) — «Marcar pagado» desde Cuentas por
// pagar. Exige finanzas.modificar acá y otra vez en lib/finanzas
// (gastos-db.ts / por-pagar-db.ts). Cada partida se actualiza en su
// propia tabla: el gasto en `gastos`, la orden en `ordenes_compra` y lo de
// las ventas, como un pago nuevo en `pagos_terceros_ventas` (28-nov).

const RUTA = "/panel/finanzas/por-pagar";

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? "");

// Solo rutas de esta pantalla: nunca un redirect abierto.
function rutaDeVuelta(formData: FormData): string {
  const volver = texto(formData, "volver");
  return volver.startsWith(`${RUTA}?`) && !volver.includes("//") ? volver : RUTA;
}

export async function marcarPagadoPorPagarAction(formData: FormData) {
  const ctx = await usuarioYEmpresaActiva();
  await requierePermiso(ctx.usuarioId, ctx.empresaId, "finanzas", "modificar");
  const ruta = rutaDeVuelta(formData);
  const origen = texto(formData, "origen");
  const id = texto(formData, "id");
  const pago = { fechaPago: texto(formData, "fechaPago"), medioPago: texto(formData, "medioPago") };
  let destino = conMensaje(ruta, "ok", "Marcado como pagado.");
  try {
    if (origen === "gasto") {
      await marcarGastoPagado({ ...ctx, gastoId: id, ...pago });
    } else if (origen === "orden") {
      await marcarOrdenCompraPagada({ ...ctx, ordenId: id, ...pago });
    } else if (origen === "ventas") {
      await marcarVentasPagadas({ ...ctx, clave: id, ...pago });
    } else {
      throw new GastoInvalidoError("No se reconoce el origen de la partida.");
    }
  } catch (error) {
    // Solo los errores esperados (textos fijos de este código) van a la URL.
    if (!(error instanceof GastoInvalidoError || error instanceof GastoNoEncontradoError || error instanceof OrdenCompraNoEncontradaError || error instanceof PartidaVentasNoPendienteError)) throw error;
    destino = conMensaje(ruta, "error", error.message);
  }
  redirect(destino);
}
