"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { registrarRecepcion } from "@/lib/inventario/compras";
import { conAviso, lineasDelFormulario, mensajeParaPersona, textoDe, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";

export async function ingresoDirectoAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const ruta = "/panel/inventario/ingresos";
  let resultado;
  try {
    resultado = await registrarRecepcion(empresaId, usuarioId, {
      recepcionId: String(formData.get("recepcionId") ?? ""),
      ordenCompraId: null,
      bodegaId: String(formData.get("bodegaId") ?? ""),
      nota: textoDe(formData.get("nota")),
      lineas: lineasDelFormulario(formData, 10),
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(ruta, "error", mensaje));
  }
  redirect(conAviso(ruta, "ok", resultado.yaRegistrada ? "Ese ingreso ya estaba registrado." : "Ingreso registrado: el stock ya subió."));
}
