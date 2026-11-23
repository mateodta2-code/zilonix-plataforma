"use server";

import { redirect } from "next/navigation";
import { MENSAJE_ACEPTACION_REQUERIDA, registrarAceptacionTerminos, validarAceptacionTerminos } from "@/lib/legal/aceptacion";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { crearEmpresaAction } from "./actions";

// Envuelve crearEmpresaAction (sin tocarla) para exigir y registrar la
// aceptación de Términos y Política antes de crear la empresa.
export async function crearEmpresaConTerminosAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  if (!validarAceptacionTerminos(formData)) {
    throw new Error(MENSAJE_ACEPTACION_REQUERIDA);
  }

  if (usuario.clerkUserId) await registrarAceptacionTerminos(usuario.clerkUserId);

  return crearEmpresaAction(formData);
}
