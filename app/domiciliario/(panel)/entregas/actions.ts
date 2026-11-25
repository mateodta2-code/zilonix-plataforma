"use server";

import { revalidatePath } from "next/cache";
import { accesoBodega } from "@/lib/bodega/contexto";
import { cambiarEstadoMiEntrega, EntregaInvalidaError, type EstadoNuevoEntrega } from "@/lib/entregas/entregas";
import { componerMotivo } from "@/lib/entregas/motivos";

type ResultadoAccion = { ok: true } | { ok: false; error: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Siempre con la membresía de domiciliario de la sesión: la bodega y el
// usuario salen de accesoBodega, nunca del cliente. RLS limita a SUS filas.
async function cambiar(entregaId: string, nuevo: EstadoNuevoEntrega, motivo?: string): Promise<ResultadoAccion> {
  const { usuario, decision } = await accesoBodega("domiciliario");
  if (!decision.ok) return { ok: false, error: "No tienes permiso para cambiar entregas." };
  if (!UUID_RE.test(entregaId)) return { ok: false, error: "Esa entrega no está disponible." };
  try {
    await cambiarEstadoMiEntrega(decision.membresia.bodegaId, usuario.id, entregaId, nuevo, motivo);
  } catch (error) {
    if (error instanceof EntregaInvalidaError) return { ok: false, error: error.message };
    return { ok: false, error: "No se pudo cambiar el estado de la entrega." };
  }
  revalidatePath("/domiciliario");
  revalidatePath("/domiciliario/entregas");
  revalidatePath("/panel/despachos");
  return { ok: true };
}

export async function salirAEntregarAction(entregaId: string): Promise<ResultadoAccion> {
  return cambiar(entregaId, "en_camino");
}

export async function marcarEntregadoAction(entregaId: string): Promise<ResultadoAccion> {
  return cambiar(entregaId, "entregada");
}

export async function marcarNoEntregadoAction(entregaId: string, claveMotivo: string, detalle: string): Promise<ResultadoAccion> {
  const motivo = componerMotivo(String(claveMotivo ?? ""), String(detalle ?? ""));
  if (!motivo) return { ok: false, error: "Indica el motivo de la no entrega." };
  return cambiar(entregaId, "no_entregada", motivo);
}
