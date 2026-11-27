"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { conMensaje } from "@/lib/finanzas/contexto-accion";
import { AutorregistroBodegaError, crearBodegaAutorregistro, superaLimiteAutorregistro } from "@/lib/bodega/autorregistro";
import { COOKIE_BODEGA_ACTUAL, RUTA_LOGIN } from "@/lib/bodega/contexto";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

const RUTA = "/bodega/crear";

// Misma lectura de IP que el middleware: detrás del proxy de Railway la IP
// real viene en x-forwarded-for.
function ipDeLaPeticion(): string {
  return headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
}

export async function crearBodegaAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect(RUTA_LOGIN.bodega);

  // Endpoint público nuevo: el límite corre ANTES de tocar la base.
  if (superaLimiteAutorregistro(usuario.id, ipDeLaPeticion())) {
    redirect(conMensaje(RUTA, "error", "Hiciste demasiados intentos. Espera una hora e inténtalo de nuevo."));
  }

  let destino: string;
  try {
    const { bodegaId } = await crearBodegaAutorregistro(usuario.id, {
      nombre: String(formData.get("nombre") ?? ""),
      nit: String(formData.get("nit") ?? ""),
      sede: { nombre: String(formData.get("sedeNombre") ?? ""), direccion: String(formData.get("sedeDireccion") ?? ""), ciudad: String(formData.get("sedeCiudad") ?? "") },
    });
    cookies().set(COOKIE_BODEGA_ACTUAL, bodegaId, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" });
    destino = "/bodega";
  } catch (error) {
    if (!(error instanceof AutorregistroBodegaError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
