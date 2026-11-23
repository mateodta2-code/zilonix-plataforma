"use server";

import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { DisponibleInvalidoError } from "@/lib/finanzas/disponible";
import {
  cambiarActivaCuentaDisponible,
  crearCuentaDisponible,
  CuentaDisponibleRepetidaError,
  registrarSaldoDisponible,
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

export async function cambiarActivaCuentaDisponibleAction(formData: FormData) {
  const activa = formData.get("activa") === "1";
  await ejecutar(activa ? "Cuenta reactivada." : "Cuenta desactivada.", ({ usuarioId, empresaId }) =>
    cambiarActivaCuentaDisponible({ empresaId, usuarioId, cuentaId: texto(formData, "cuentaId"), activa })
  );
}
