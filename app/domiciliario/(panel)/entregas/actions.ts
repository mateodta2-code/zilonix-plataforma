"use server";

import { revalidatePath } from "next/cache";
import { accesoBodega } from "@/lib/bodega/contexto";
import { CloudinaryNoConfiguradoError, subirFotoPrivada } from "@/lib/cloudinary";
import { cambiarEstadoMiEntrega, EntregaInvalidaError, miEntregaAbierta, type EstadoNuevoEntrega } from "@/lib/entregas/entregas";
import { validarFotoEntrega } from "@/lib/entregas/foto";
import { componerMotivo } from "@/lib/entregas/motivos";

type ResultadoAccion = { ok: true } | { ok: false; error: string };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Siempre con la membresía de domiciliario de la sesión: la bodega y el
// usuario salen de accesoBodega, nunca del cliente. RLS limita a SUS filas.
async function cambiar(entregaId: string, nuevo: EstadoNuevoEntrega, motivo?: string, foto?: File): Promise<ResultadoAccion> {
  const { usuario, decision } = await accesoBodega("domiciliario");
  if (!decision.ok) return { ok: false, error: "No tienes permiso para cambiar entregas." };
  if (!UUID_RE.test(entregaId)) return { ok: false, error: "Esa entrega no está disponible." };
  const { bodegaId } = decision.membresia;
  try {
    let fotoPublicId: string | undefined;
    if (nuevo === "entregada") {
      // Domi-3: primero se valida la foto y que la entrega sea SUYA y
      // siga abierta; recién ahí se sube (privada) a Cloudinary.
      const bytes = foto ? new Uint8Array(await foto.arrayBuffer()) : null;
      const problema = validarFotoEntrega(bytes);
      if (problema || !bytes) return { ok: false, error: problema ?? "Toma la foto de la entrega para confirmarla." };
      const { empresaId } = await miEntregaAbierta(bodegaId, usuario.id, entregaId);
      // public_id = id de la entrega: si reintenta, reemplaza la misma foto.
      fotoPublicId = (await subirFotoPrivada(Buffer.from(bytes), `zilonix-entregas/${empresaId}`, entregaId)).publicId;
    }
    await cambiarEstadoMiEntrega(bodegaId, usuario.id, entregaId, nuevo, motivo, fotoPublicId);
  } catch (error) {
    if (error instanceof EntregaInvalidaError) return { ok: false, error: error.message };
    if (error instanceof CloudinaryNoConfiguradoError) return { ok: false, error: "No se pudo guardar la foto: falta configurar el almacenamiento de fotos." };
    console.error("[domiciliario/entregas] no se pudo cambiar la entrega:", error instanceof Error ? error.name : error);
    return { ok: false, error: nuevo === "entregada" ? "No se pudo guardar la foto. Revisa tu conexión e intenta otra vez." : "No se pudo cambiar el estado de la entrega." };
  }
  revalidatePath("/domiciliario");
  revalidatePath("/domiciliario/entregas");
  revalidatePath("/panel/despachos");
  return { ok: true };
}

export async function salirAEntregarAction(entregaId: string): Promise<ResultadoAccion> {
  return cambiar(entregaId, "en_camino");
}

// Domi-3: la foto viaja en un FormData (campo «foto»), ya reducida a JPEG
// en el celular.
export async function marcarEntregadoAction(entregaId: string, datos: FormData): Promise<ResultadoAccion> {
  const foto = datos?.get?.("foto");
  return cambiar(entregaId, "entregada", undefined, foto instanceof File ? foto : undefined);
}

export async function marcarNoEntregadoAction(entregaId: string, claveMotivo: string, detalle: string): Promise<ResultadoAccion> {
  const motivo = componerMotivo(String(claveMotivo ?? ""), String(detalle ?? ""));
  if (!motivo) return { ok: false, error: "Indica el motivo de la no entrega." };
  return cambiar(entregaId, "no_entregada", motivo);
}
