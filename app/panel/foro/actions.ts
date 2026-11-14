"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { crearPregunta, crearRespuesta, ForoError } from "@/lib/foro";

export type EstadoForo = { ok: true; preguntaId?: string } | { ok: false; error: string };

// El candado real (tener al menos una empresa en Zilonix) lo pide
// lib/foro.ts en cada función que escribe, con el usuario de la sesión
// — nunca un id que mande el cliente. Un error que no sea ForoError
// nunca llega al cliente con su texto crudo.
async function publicar(fn: (usuarioId: string) => Promise<EstadoForo>): Promise<EstadoForo> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  try {
    return await fn(usuario.id);
  } catch (error) {
    if (error instanceof ForoError) return { ok: false, error: error.message };
    console.error("[foro] no se pudo publicar", error);
    return { ok: false, error: "No se pudo publicar. Vuelve a intentar en un momento." };
  }
}

export async function crearPreguntaAction(titulo: string, cuerpo: string): Promise<EstadoForo> {
  return publicar(async (usuarioId) => {
    const preguntaId = await crearPregunta(usuarioId, titulo, cuerpo);
    revalidatePath("/panel/foro");
    return { ok: true, preguntaId };
  });
}

export async function crearRespuestaAction(preguntaId: string, cuerpo: string): Promise<EstadoForo> {
  return publicar(async (usuarioId) => {
    await crearRespuesta(usuarioId, preguntaId, cuerpo);
    revalidatePath(`/panel/foro/${preguntaId}`);
    revalidatePath("/panel/foro");
    return { ok: true };
  });
}
