"use server";

import { redirect, RedirectType } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { agregarSeguimiento, buscarSeguimientoActivoPorMlId, eliminarSeguimiento, marcarAlertaLeida } from "@/lib/seguimiento/seguimientos";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

// Issue #175 — mismo permiso que "Investigación" para ver (inventario,
// consultar); agregar/quitar un seguimiento o marcar una alerta es una
// escritura, pide "modificar" — mismo criterio que
// app/panel/publicar/clip/actions.ts.
export async function agregarSeguimientoAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const tipo = String(formData.get("tipo") ?? "");
  const link = String(formData.get("link") ?? "").trim();
  const esCompetidor = formData.get("esCompetidor") === "1";
  if ((tipo !== "producto" && tipo !== "tienda") || !link) {
    throw new Error("Elegí el tipo y pegá un link o id de Mercado Libre.");
  }

  try {
    await agregarSeguimiento(empresa.id, usuario.id, { tipo, link, esCompetidor });
  } catch (error) {
    // Mensaje legible en vez de la pantalla de error genérica de
    // Next.js — los 3 tipos reales que agregarSeguimiento puede
    // lanzar ya traen un mensaje en español claro.
    const mensaje = error instanceof Error ? error.message : "No se pudo agregar el seguimiento.";
    redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent(mensaje)}`);
  }

  redirect("/panel/investigacion/seguimiento?agregado=1");
}

// Issue #182 — la extensión (0.3.0, "Seguir en Zilonix") abre esta
// pantalla con ?agregar=<itemId MCO> o ?agregar_tienda=<sellerId
// numérico>; page.tsx ya validó el FORMATO del id (/^MCO\d+$/ o
// /^\d+$/) antes de llamar acá — esta función hace el resto: mismo
// permiso que agregarSeguimientoAction (inventario, modificar), chequea
// si ya existe un seguimiento activo con ese id (para avisar "ya
// existía" en vez de reinsertar) y, si no, llama a agregarSeguimiento()
// directo con el id ya resuelto (acepta link O id, ver
// lib/seguimiento/link.ts). Siempre termina en un redirect REPLACE a la
// misma ruta sin el query de agregar, para que F5 (o volver atrás) no
// lo vuelva a disparar.
export async function procesarAgregarPorQuery(empresaId: string, usuarioId: string, datos: { tipo: "producto" | "tienda"; mlIdExterno: string }): Promise<void> {
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "modificar");
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
    redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent("No tenés permiso para agregar seguimientos — hace falta el permiso de modificar inventario.")}`, RedirectType.replace);
  }

  const existente = await buscarSeguimientoActivoPorMlId(empresaId, datos.mlIdExterno);
  if (existente) {
    redirect("/panel/investigacion/seguimiento?yaExistia=1", RedirectType.replace);
  }

  try {
    await agregarSeguimiento(empresaId, usuarioId, { tipo: datos.tipo, link: datos.mlIdExterno, esCompetidor: false });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : "No se pudo agregar el seguimiento.";
    redirect(`/panel/investigacion/seguimiento?error=${encodeURIComponent(mensaje)}`, RedirectType.replace);
  }

  redirect("/panel/investigacion/seguimiento?agregado=1", RedirectType.replace);
}

export async function eliminarSeguimientoAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const seguimientoId = String(formData.get("seguimientoId") ?? "");
  if (!seguimientoId) throw new Error("Falta el seguimiento a quitar.");

  await eliminarSeguimiento(empresa.id, seguimientoId);
  redirect("/panel/investigacion/seguimiento?eliminado=1");
}

export async function marcarAlertaLeidaAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const alertaId = String(formData.get("alertaId") ?? "");
  if (!alertaId) throw new Error("Falta la alerta a marcar.");

  await marcarAlertaLeida(empresa.id, alertaId);
  redirect("/panel/investigacion/seguimiento?leida=1");
}
