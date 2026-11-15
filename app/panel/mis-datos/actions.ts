"use server";

import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { anonimizarCuentaPropia, exportarDatosPropios, type ResultadoAnonimizacion } from "@/lib/datos-personales";

// Issue #318 — el id de quien actúa SIEMPRE sale de la sesión real de
// Clerk (obtenerOCrearUsuarioActual), nunca de un parámetro que mande
// el cliente: estas dos acciones no reciben NINGÚN id de usuario, así
// que no hay forma de pedir el borrado/exportación de otra persona.
async function usuarioDeLaSesion() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) throw new Error("Sin sesión.");
  return usuario;
}

export type RespuestaExportar = { ok: true; json: string } | { ok: false; error: string };

export async function exportarMisDatosAction(): Promise<RespuestaExportar> {
  try {
    const usuario = await usuarioDeLaSesion();
    const datos = await exportarDatosPropios(usuario);
    return { ok: true, json: JSON.stringify(datos, null, 2) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "No se pudieron exportar tus datos." };
  }
}

export type RespuestaBorrar = ResultadoAnonimizacion | { ok: false; motivo: "error"; error: string };

export async function borrarMiCuentaAction(): Promise<RespuestaBorrar> {
  try {
    const usuario = await usuarioDeLaSesion();
    return await anonimizarCuentaPropia(usuario);
  } catch (error) {
    return { ok: false, motivo: "error", error: error instanceof Error ? error.message : "No se pudo borrar tu cuenta." };
  }
}
