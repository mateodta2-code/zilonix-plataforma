"use server";

import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { GastoInvalidoError, validarGasto } from "@/lib/finanzas/gastos";
import { CategoriaGastoInvalidaError } from "@/lib/finanzas/gastos-categorias";
import {
  actualizarCategoriaGasto,
  CategoriaGastoRepetidaError,
  crearCategoriaGasto,
  crearGasto,
  editarGasto,
  GastoNoEncontradoError,
  marcarGastoPagado,
} from "@/lib/finanzas/gastos-db";
import { MontoInvalidoError } from "@/lib/finanzas/montos";
import { requierePermiso } from "@/lib/permisos";

// Issue #422 (fase 4 de Finanzas) — gastos externos. Cada acción exige
// finanzas.modificar en el servidor (y lib/finanzas/gastos-db.ts lo
// vuelve a pedir); ver la pantalla solo pide finanzas.consultar.

const RUTA = "/panel/finanzas/gastos";
const RUTA_CATEGORIAS = "/panel/finanzas/gastos/categorias";

const texto = (formData: FormData, campo: string) => String(formData.get(campo) ?? "");

function leerFormularioGasto(formData: FormData) {
  return validarGasto({
    tienda: texto(formData, "tienda"),
    categoriaId: texto(formData, "categoriaId"),
    terceroId: texto(formData, "terceroId"),
    beneficiario: texto(formData, "beneficiario"),
    descripcion: texto(formData, "descripcion"),
    monto: texto(formData, "monto"),
    fechaGasto: texto(formData, "fechaGasto"),
    fechaVencimiento: texto(formData, "fechaVencimiento"),
    pagado: formData.get("pagado") === "on",
    fechaPago: texto(formData, "fechaPago"),
    medioPago: texto(formData, "medioPago"),
    soporte: texto(formData, "soporte"),
  });
}

// Solo los errores esperados (textos fijos de este código) van a la URL.
function mensajeDe(error: unknown): string | null {
  if (
    error instanceof GastoInvalidoError ||
    error instanceof GastoNoEncontradoError ||
    error instanceof MontoInvalidoError ||
    error instanceof CategoriaGastoInvalidaError ||
    error instanceof CategoriaGastoRepetidaError
  ) {
    return error.message;
  }
  return null;
}

// Para volver a la misma vista de filtros después de crear o pagar.
// Solo rutas de esta pantalla: nunca un redirect abierto.
function rutaDeVuelta(formData: FormData): string {
  const volver = texto(formData, "volver");
  return volver.startsWith(`${RUTA}?`) && !volver.includes("//") ? volver : RUTA;
}

async function ejecutar(ruta: string, ok: string, accion: (ctx: { usuarioId: string; empresaId: string }) => Promise<unknown>) {
  const ctx = await usuarioYEmpresaActiva();
  await requierePermiso(ctx.usuarioId, ctx.empresaId, "finanzas", "modificar");
  let destino = conMensaje(ruta, "ok", ok);
  try {
    await accion(ctx);
  } catch (error) {
    const mensaje = mensajeDe(error);
    if (!mensaje) throw error;
    destino = conMensaje(ruta, "error", mensaje);
  }
  redirect(destino);
}

export async function crearGastoAction(formData: FormData) {
  await ejecutar(rutaDeVuelta(formData), "Gasto registrado.", ({ usuarioId, empresaId }) =>
    crearGasto({ empresaId, usuarioId, datos: leerFormularioGasto(formData) })
  );
}

export async function editarGastoAction(formData: FormData) {
  const gastoId = texto(formData, "gastoId");
  await ejecutar(RUTA, "Gasto actualizado.", ({ usuarioId, empresaId }) =>
    editarGasto({ empresaId, usuarioId, gastoId, datos: leerFormularioGasto(formData) })
  );
}

export async function marcarPagadoAction(formData: FormData) {
  await ejecutar(rutaDeVuelta(formData), "Gasto marcado como pagado.", ({ usuarioId, empresaId }) =>
    marcarGastoPagado({
      empresaId,
      usuarioId,
      gastoId: texto(formData, "gastoId"),
      fechaPago: texto(formData, "fechaPago"),
      medioPago: texto(formData, "medioPago"),
    })
  );
}

export async function crearCategoriaAction(formData: FormData) {
  await ejecutar(RUTA_CATEGORIAS, "Categoría creada.", ({ usuarioId, empresaId }) =>
    crearCategoriaGasto({ empresaId, usuarioId, nombre: texto(formData, "nombre") })
  );
}

export async function actualizarCategoriaAction(formData: FormData) {
  await ejecutar(RUTA_CATEGORIAS, "Categoría actualizada.", ({ usuarioId, empresaId }) =>
    actualizarCategoriaGasto({
      empresaId,
      usuarioId,
      categoriaId: texto(formData, "categoriaId"),
      nombre: texto(formData, "nombre"),
      activa: formData.get("activa") === "on",
    })
  );
}
