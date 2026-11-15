"use server";

import { redirect } from "next/navigation";
import { leerMonto } from "@/lib/importar-archivo";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { MontoInvalidoError } from "@/lib/finanzas/montos";
import { requierePermiso } from "@/lib/permisos";
import {
  actualizarTercero,
  crearTercero,
  TerceroInvalidoError,
  TerceroNoEncontradoError,
  TerceroRepetidoError,
  type CondicionPago,
  type Periodicidad,
  type TipoTercero,
} from "@/lib/terceros";

// Issue #128 (Z-FIN-06) — alta, edición, desactivación y reactivación
// de proveedores y transportadores. Cada acción exige finanzas.modificar
// en el servidor; lib/terceros.ts deja el rastro en `auditoria`.

const TIPOS: TipoTercero[] = ["proveedor_producto", "empaque", "agencia", "flex", "otro"];
const CONDICIONES: CondicionPago[] = ["inmediato", "cuenta_cobro", "anticipado_full_ml"];
const PERIODICIDADES: Periodicidad[] = ["semanal", "quincenal", "mensual"];
const RUTA = "/panel/finanzas/proveedores";

function deLista<T extends string>(valor: FormDataEntryValue | null, lista: T[]): T | undefined {
  return lista.find((v) => v === valor);
}

function leerFormulario(formData: FormData) {
  const tipo = deLista(formData.get("tipo"), TIPOS);
  if (!tipo) throw new TerceroInvalidoError("Elige el tipo de tercero.");

  const empaqueTexto = String(formData.get("empaque") ?? "");
  const empaque = leerMonto({ tipo: "texto", valor: empaqueTexto });
  if (empaque.tipo === "error") throw new MontoInvalidoError("Packing");

  const plazoTexto = String(formData.get("plazoDias") ?? "").trim();
  if (plazoTexto && !/^\d{1,4}$/.test(plazoTexto)) throw new TerceroInvalidoError("El plazo tiene que ser un número entero de días.");

  return {
    nombre: String(formData.get("nombre") ?? ""),
    tipo,
    empaque: empaque.tipo === "monto" ? empaque.valor : null,
    // "" = según el tipo (agencia y flex nacen como cuenta de cobro semanal).
    condicionPago: deLista(formData.get("condicionPago"), CONDICIONES),
    periodicidad: deLista(formData.get("periodicidad"), PERIODICIDADES),
    plazoDias: plazoTexto ? Number(plazoTexto) : null,
    predeterminadoEnvioAgencia: formData.get("predeterminadoEnvioAgencia") === "on",
    predeterminadoEmpaque: formData.get("predeterminadoEmpaque") === "on",
    predeterminadoFlex: formData.get("predeterminadoFlex") === "on",
  };
}

function mensajeDe(error: unknown): string | null {
  if (
    error instanceof TerceroInvalidoError ||
    error instanceof TerceroRepetidoError ||
    error instanceof TerceroNoEncontradoError ||
    error instanceof MontoInvalidoError
  ) {
    return error.message;
  }
  return null;
}

export async function crearProveedorAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  let destino = conMensaje(RUTA, "ok", "Tercero creado.");
  try {
    const datos = leerFormulario(formData);
    await crearTercero({ empresaId, usuarioId, ...datos, periodicidad: datos.periodicidad });
  } catch (error) {
    const mensaje = mensajeDe(error);
    if (!mensaje) throw error;
    destino = conMensaje(RUTA, "error", mensaje);
  }
  redirect(destino);
}

export async function editarProveedorAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  const terceroId = String(formData.get("terceroId") ?? "");
  let destino = conMensaje(RUTA, "ok", "Cambios guardados.");
  try {
    const datos = leerFormulario(formData);
    await actualizarTercero({
      empresaId,
      usuarioId,
      terceroId,
      cambios: {
        ...datos,
        // En la edición el select siempre trae un valor; vacío = sin periodicidad.
        condicionPago: datos.condicionPago,
        periodicidad: datos.periodicidad ?? null,
      },
    });
  } catch (error) {
    const mensaje = mensajeDe(error);
    if (!mensaje) throw error;
    destino = conMensaje(`${RUTA}/${encodeURIComponent(terceroId)}`, "error", mensaje);
  }
  redirect(destino);
}

export async function cambiarActivoProveedorAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  const terceroId = String(formData.get("terceroId") ?? "");
  const activo = formData.get("activo") === "1";
  let destino = conMensaje(RUTA, "ok", activo ? "Tercero activado." : "Tercero desactivado.");
  try {
    await actualizarTercero({ empresaId, usuarioId, terceroId, cambios: { activo } });
  } catch (error) {
    const mensaje = mensajeDe(error);
    if (!mensaje) throw error;
    destino = conMensaje(RUTA, "error", mensaje);
  }
  redirect(destino);
}
