"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { deshacerDespachado, DespachoNoEncontradoError, GuiaNoVistaError, marcarDespachado, VentanaDeshacerVencidaError } from "@/lib/ml/despachos";

type ResultadoAccion = { ok: true } | { ok: false; error: string };

// Fase 1 de Despachos (issue "Despachos", punto 4) — se llaman directo
// desde un componente de cliente (no un <form action>, ni redirect):
// la tarjeta necesita moverse de pestaña y mostrar "Deshacer" sin
// recargar toda la página. Nunca llaman a Mercado Libre (pedido
// explícito de la tarea) — solo tocan despachos_ml.
async function usuarioYEmpresaActiva() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return null;
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return null;
  return { usuarioId: usuario.id, empresaId: empresa.id };
}

export async function marcarDespachadoAction(despachoId: string): Promise<ResultadoAccion> {
  const sesion = await usuarioYEmpresaActiva();
  if (!sesion) return { ok: false, error: "Sin sesión." };
  try {
    await requierePermiso(sesion.usuarioId, sesion.empresaId, "ventas", "modificar");
    await marcarDespachado(sesion.empresaId, despachoId, sesion.usuarioId);
  } catch (error) {
    if (error instanceof GuiaNoVistaError) return { ok: false, error: error.message };
    if (error instanceof DespachoNoEncontradoError) return { ok: false, error: error.message };
    const mensaje = error instanceof Error ? error.message : "No se pudo marcar el despacho.";
    return { ok: false, error: mensaje };
  }
  revalidatePath("/panel/despachos");
  return { ok: true };
}

export async function deshacerDespachadoAction(despachoId: string): Promise<ResultadoAccion> {
  const sesion = await usuarioYEmpresaActiva();
  if (!sesion) return { ok: false, error: "Sin sesión." };
  try {
    await requierePermiso(sesion.usuarioId, sesion.empresaId, "ventas", "modificar");
    await deshacerDespachado(sesion.empresaId, despachoId);
  } catch (error) {
    if (error instanceof VentanaDeshacerVencidaError) return { ok: false, error: error.message };
    if (error instanceof DespachoNoEncontradoError) return { ok: false, error: error.message };
    const mensaje = error instanceof Error ? error.message : "No se pudo deshacer.";
    return { ok: false, error: mensaje };
  }
  revalidatePath("/panel/despachos");
  return { ok: true };
}
