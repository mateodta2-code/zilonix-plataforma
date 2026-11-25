"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AnuncioInvalidoError, crearAnuncio, retirarAnuncio } from "@/lib/anuncios";
import { requiereSesionSuperadmin } from "@/lib/superadmin";
import { esUuid } from "@/lib/validacion";

// Anuncios de la plataforma (25-nov). Toda acción pide sesión de superadmin
// propia y deja su renglón en auditoría (lib/anuncios.ts). Un error esperado
// vuelve a la pantalla con su mensaje (?error=), nunca un 500.
const RUTA = "/superadmin/anuncios";

function conError(error: unknown): never {
  if (!(error instanceof AnuncioInvalidoError)) throw error;
  redirect(`${RUTA}?error=${encodeURIComponent(error.message)}`);
}

function refrescar() {
  revalidatePath(RUTA);
  // El anuncio sale en todo /panel: se refresca el marco completo.
  revalidatePath("/panel", "layout");
}

export async function crearAnuncioAction(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  try {
    await crearAnuncio(usuarioId, {
      mensaje: String(formData.get("mensaje") ?? ""),
      tipo: String(formData.get("tipo") ?? ""),
      desde: String(formData.get("desde") ?? ""),
      hasta: String(formData.get("hasta") ?? ""),
    });
  } catch (error) {
    conError(error);
  }
  refrescar();
  redirect(RUTA);
}

export async function retirarAnuncioAction(formData: FormData) {
  const { usuarioId } = await requiereSesionSuperadmin();
  const anuncioId = String(formData.get("anuncioId") ?? "");
  try {
    if (!esUuid(anuncioId)) throw new AnuncioInvalidoError("Ese anuncio ya no está publicado.");
    await retirarAnuncio(usuarioId, anuncioId);
  } catch (error) {
    conError(error);
  }
  refrescar();
  redirect(RUTA);
}
