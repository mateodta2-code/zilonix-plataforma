"use server";

import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { DisponibleInvalidoError } from "@/lib/finanzas/disponible";
import {
  cambiarActivaCuentaDisponible,
  crearCuentaDisponible,
  CuentaDisponibleRepetidaError,
  registrarSaldoDisponible,
  sincronizarSaldoMp,
  type CodigoErrorSaldoMp,
} from "@/lib/finanzas/disponible-consulta";
import { diaBogota } from "@/lib/finanzas/utilidad-venta";
import { requierePermiso } from "@/lib/permisos";

// Issue #422 (fase 6, Disponible) — crear cuentas, registrar saldos y
// desactivar/reactivar una cuenta. Cada acción exige finanzas.modificar
// acá y otra vez en lib/finanzas/disponible-consulta.ts.

const RUTA = "/panel/finanzas/disponible";

function texto(formData: FormData, campo: string): string {
  return String(formData.get(campo) ?? "");
}

function mensajeDe(error: unknown): string | null {
  if (error instanceof DisponibleInvalidoError || error instanceof CuentaDisponibleRepetidaError) return error.message;
  return null;
}

async function ejecutar(okMensaje: string, fn: (ctx: { usuarioId: string; empresaId: string }) => Promise<unknown>) {
  const ctx = await usuarioYEmpresaActiva();
  await requierePermiso(ctx.usuarioId, ctx.empresaId, "finanzas", "modificar");
  let destino = conMensaje(RUTA, "ok", okMensaje);
  try {
    await fn(ctx);
  } catch (error) {
    const mensaje = mensajeDe(error);
    if (!mensaje) throw error;
    destino = conMensaje(RUTA, "error", mensaje);
  }
  redirect(destino);
}

export async function crearCuentaDisponibleAction(formData: FormData) {
  await ejecutar("Cuenta creada.", ({ usuarioId, empresaId }) =>
    crearCuentaDisponible({
      empresaId,
      usuarioId,
      nombre: texto(formData, "nombre"),
      tipo: texto(formData, "tipo"),
      entidad: texto(formData, "entidad"),
      ultimos4: texto(formData, "ultimos4"),
      moneda: texto(formData, "moneda"),
    })
  );
}

export async function registrarSaldoDisponibleAction(formData: FormData) {
  await ejecutar("Saldo registrado.", ({ usuarioId, empresaId }) =>
    registrarSaldoDisponible({
      empresaId,
      usuarioId,
      cuentaId: texto(formData, "cuentaId"),
      saldo: texto(formData, "saldo"),
      fechaCorte: texto(formData, "fechaCorte"),
      nota: texto(formData, "nota"),
      hoy: diaBogota(new Date()),
    })
  );
}

const MENSAJE_ERROR_SALDO_MP: Record<CodigoErrorSaldoMp, string> = {
  mp_401: "Mercado Pago rechazó la conexión: reconecta la cuenta en Conectar.",
  mp_403: "Mercado Pago no dio permiso para leer el reporte de liberaciones de esta cuenta.",
  mp_404: "Mercado Pago no encontró el reporte de liberaciones.",
  mp_http: "Mercado Pago respondió con un error. Inténtalo de nuevo en unos minutos.",
  mp_red: "No se pudo contactar a Mercado Pago. Inténtalo de nuevo en unos minutos.",
  mp_sin_config: "No se pudo configurar el reporte de liberaciones en Mercado Pago.",
  mp_sin_datos: "El reporte de liberaciones de Mercado Pago no trae un saldo legible.",
  mp_renovando: "Se está renovando la conexión con Mercado Pago: inténtalo de nuevo en unos segundos.",
  mp_reconectar: "Hay que reconectar la cuenta de Mercado Pago en Conectar.",
  mp_error: "No se pudo actualizar el saldo de Mercado Pago.",
};

// «Actualizar saldo» / «Revisar reporte» de una cuenta de Mercado Pago.
// Se usa con .bind(null, cuentaMpId) desde la página.
export async function sincronizarSaldoMpAction(cuentaMpId: string) {
  const ctx = await usuarioYEmpresaActiva();
  await requierePermiso(ctx.usuarioId, ctx.empresaId, "finanzas", "modificar");
  let destino: string;
  try {
    const r = await sincronizarSaldoMp({ ...ctx, cuentaMpId: String(cuentaMpId) });
    destino =
      r.estado === "actualizado"
        ? conMensaje(RUTA, "ok", `Saldo de Mercado Pago actualizado (corte ${r.fechaCorte}).`)
        : r.estado === "en_preparacion"
          ? conMensaje(RUTA, "ok", "Mercado Pago está generando el reporte de liberaciones; vuelve a darle Actualizar en 2–3 minutos.")
          : conMensaje(RUTA, "error", MENSAJE_ERROR_SALDO_MP[r.codigo]);
  } catch (error) {
    const mensaje = mensajeDe(error);
    if (!mensaje) throw error;
    destino = conMensaje(RUTA, "error", mensaje);
  }
  redirect(destino);
}

export async function cambiarActivaCuentaDisponibleAction(formData: FormData) {
  const activa = formData.get("activa") === "1";
  await ejecutar(activa ? "Cuenta reactivada." : "Cuenta desactivada.", ({ usuarioId, empresaId }) =>
    cambiarActivaCuentaDisponible({ empresaId, usuarioId, cuentaId: texto(formData, "cuentaId"), activa })
  );
}
