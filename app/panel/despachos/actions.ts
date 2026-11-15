"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { textoResultadoCuenta, traerVentasDelMes } from "@/lib/finanzas/traer-ventas-mes";
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

export type ResultadoSincronizarAhora = { ok: true; resumen: string } | { ok: false; error: string };

// Issue "pendientes no muestra venta nueva" — bug real reportado por
// Mateo en staging: una venta nueva (ready_to_ship en Mercado Libre)
// no aparecía en Pendientes porque nadie había vuelto a apretar
// "Traer ventas de este mes" (Finanzas) desde que se vendió — la
// sincronización periódica es manual, issue #49 todavía no tiene cola
// automática/avisos en tiempo real. Este botón reusa EXACTAMENTE esa
// misma función (traerVentasDelMes, lib/finanzas/traer-ventas-mes.ts)
// desde Despachos, para no tener que ir a otra pantalla a traer una
// venta nueva al instante. Mismo permiso que ya exige esa función
// ("finanzas"/"modificar": escribe en pedidos_finanzas) — nunca
// "ventas"/"modificar", que es lo que ya exige marcar/deshacer acá.
export async function sincronizarAhoraAction(): Promise<ResultadoSincronizarAhora> {
  const sesion = await usuarioYEmpresaActiva();
  if (!sesion) return { ok: false, error: "Sin sesión." };
  try {
    const resultados = await traerVentasDelMes(sesion.empresaId, sesion.usuarioId, null, new Date());
    if (resultados.length === 0) return { ok: false, error: "No hay cuentas de Mercado Libre conectadas para sincronizar." };
    revalidatePath("/panel/despachos");
    return { ok: true, resumen: resultados.map(textoResultadoCuenta).join(" ") };
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, error: error.message };
    const mensaje = error instanceof Error ? error.message : "No se pudo sincronizar con Mercado Libre.";
    return { ok: false, error: mensaje };
  }
}
