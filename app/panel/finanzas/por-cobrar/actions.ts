"use server";

import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { sincronizarPorCobrarMp, type CodigoErrorPorCobrarMp } from "@/lib/finanzas/por-cobrar-consulta";
import { CuentaMpNoEncontradaError } from "@/lib/mp/cuentas";
import { requierePermiso } from "@/lib/permisos";

// Issue #422 (por cobrar) — «Actualizar desde Mercado Pago». Exige
// finanzas.modificar acá y otra vez en lib/finanzas/por-cobrar-consulta.ts.

const RUTA = "/panel/finanzas/por-cobrar";

const MENSAJE_ERROR_POR_COBRAR_MP: Record<CodigoErrorPorCobrarMp, string> = {
  mp_401: "Mercado Pago rechazó la conexión: reconecta la cuenta en Conectar.",
  mp_403: "Mercado Pago no dio permiso para leer los pagos de esta cuenta.",
  mp_429: "Mercado Pago está limitando las consultas. Inténtalo de nuevo en unos minutos.",
  mp_http: "Mercado Pago respondió con un error. Inténtalo de nuevo en unos minutos.",
  mp_red: "No se pudo contactar a Mercado Pago. Inténtalo de nuevo en unos minutos.",
  mp_renovando: "Se está renovando la conexión con Mercado Pago: inténtalo de nuevo en unos segundos.",
  mp_reconectar: "Hay que reconectar la cuenta de Mercado Pago en Conectar.",
  mp_error: "No se pudo actualizar lo por cobrar de Mercado Pago.",
};

// Se usa con .bind(null, cuentaMpId) desde la página.
export async function sincronizarPorCobrarMpAction(cuentaMpId: string) {
  const ctx = await usuarioYEmpresaActiva();
  await requierePermiso(ctx.usuarioId, ctx.empresaId, "finanzas", "modificar");
  let destino: string;
  try {
    const r = await sincronizarPorCobrarMp({ ...ctx, cuentaMpId: String(cuentaMpId) });
    destino =
      r.estado === "actualizado"
        ? conMensaje(RUTA, "ok", `Por cobrar de Mercado Pago actualizado: ${r.pagos} ${r.pagos === 1 ? "pago" : "pagos"} sin liberar.`)
        : conMensaje(RUTA, "error", MENSAJE_ERROR_POR_COBRAR_MP[r.codigo]);
  } catch (error) {
    if (!(error instanceof CuentaMpNoEncontradaError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
