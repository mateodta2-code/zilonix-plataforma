"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { crearPerfilDomiciliario, frenarAutorregistroDomiciliario, PerfilDomiciliarioError } from "@/lib/bodega/perfil-domiciliario";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

// Sin sesión no hay perfil: vuelve al registro propio del domiciliario.
export async function crearPerfilDomiciliarioAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/domiciliario/iniciar-sesion");

  const ip = headers().get("x-forwarded-for")?.split(",")[0]?.trim() || "sin-ip";
  let destino = "/domiciliario";
  try {
    frenarAutorregistroDomiciliario(usuario.id, ip);
    await crearPerfilDomiciliario(usuario.id, {
      nombre: String(formData.get("nombre") ?? ""),
      telefono: String(formData.get("telefono") ?? ""),
      ciudad: String(formData.get("ciudad") ?? ""),
    });
  } catch (error) {
    if (!(error instanceof PerfilDomiciliarioError)) throw error;
    // «Ya tienes perfil» también termina en el panel; el resto vuelve al formulario con el aviso.
    if (error.message !== "Ya tienes un perfil de domiciliario.") destino = `/domiciliario/crear-perfil?error=${encodeURIComponent(error.message)}`;
  }
  redirect(destino);
}
