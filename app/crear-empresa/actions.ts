"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { crearEmpresaConDueno } from "@/lib/empresas";
import {
  PRIVACIDAD_VERSION,
  QUE_VE_ZILONIX_VERSION,
  TERMINOS_VERSION,
  consentimientoMarcado,
} from "@/lib/legal";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";

export async function crearEmpresaAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const nombre = String(formData.get("nombre") ?? "").trim();
  const nit = String(formData.get("nit") ?? "").trim();
  if (!nombre || !nit) {
    throw new Error("Nombre y NIT son obligatorios.");
  }

  // Ley 1581 — la casilla empieza desmarcada. El valor lo decide el
  // servidor con las constantes de lib/legal.ts, no un campo oculto
  // del formulario: así el registro apunta al texto que esta versión
  // de la app muestra, no a una cadena que el navegador podría cambiar.
  if (!consentimientoMarcado(formData.get("aceptaTerminos"))) {
    throw new Error(
      "Para crear la empresa marca la casilla de términos y de autorización de datos. Empieza desmarcada."
    );
  }

  let empresaId: string;
  try {
    empresaId = await crearEmpresaConDueno(usuario.id, nombre, nit, {
      terminosVersion: TERMINOS_VERSION,
      privacidadVersion: PRIVACIDAD_VERSION,
      queVeVersion: QUE_VE_ZILONIX_VERSION,
    });
  } catch (error) {
    // 23505 = unique_violation de Postgres — el caso real esperado acá
    // es un NIT repetido (empresas.nit es único, decisión D2: una
    // empresa por NIT).
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new Error(`Ya existe una empresa registrada con el NIT ${nit}.`);
    }
    throw error;
  }

  cookies().set("empresa_actual", empresaId, { httpOnly: true, sameSite: "lax", path: "/" });
  redirect("/panel");
}
