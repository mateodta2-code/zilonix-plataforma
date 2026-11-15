"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { actualizarBodega, crearBodega, TIPOS_BODEGA, type TipoBodega } from "@/lib/inventario/bodegas";
import { conAviso, mensajeParaPersona, textoDe, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";

const RUTA = "/panel/bodegas";

export async function crearBodegaAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const tipo = String(formData.get("tipo") ?? "");
  try {
    await crearBodega(empresaId, usuarioId, {
      nombre: textoDe(formData.get("nombre")) ?? "",
      tipo: (TIPOS_BODEGA.some((t) => t.valor === tipo) ? tipo : "propia") as TipoBodega,
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", "Bodega creada."));
}

export async function actualizarBodegaAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  try {
    await actualizarBodega(empresaId, usuarioId, String(formData.get("bodegaId") ?? ""), {
      nombre: textoDe(formData.get("nombre")) ?? "",
      activa: formData.get("activa") === "on",
      esPrincipal: formData.get("esPrincipal") === "on",
      sumaAlPublicado: formData.get("sumaAlPublicado") === "on",
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", "Bodega actualizada."));
}
