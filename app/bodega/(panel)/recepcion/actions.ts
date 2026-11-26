"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje } from "@/lib/finanzas/contexto-accion";
import { accesoBodega } from "@/lib/bodega/contexto";
import { RecepcionInvalidaError, interpretarLineas, registrarRecepcion } from "@/lib/bodega/recepcion";

const RUTA = "/bodega/recepcion";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// admin_bodega y operario (el domiciliario no entra al panel de bodega).
export async function registrarRecepcionAction(formData: FormData) {
  const { usuario, decision } = await accesoBodega("bodega");
  if (!decision.ok) throw new Error("No tienes permiso para registrar recepciones.");
  let destino: string;
  try {
    const empresaId = String(formData.get("empresaId") ?? "");
    if (!UUID_RE.test(empresaId)) throw new RecepcionInvalidaError("Elige la empresa.");
    const fechaTexto = String(formData.get("fecha") ?? "");
    const fecha = fechaTexto ? new Date(`${fechaTexto}T12:00:00`) : undefined;
    if (fecha && Number.isNaN(fecha.getTime())) throw new RecepcionInvalidaError("La fecha no es válida.");
    const lineas = interpretarLineas(String(formData.get("lineas") ?? ""));
    await registrarRecepcion(decision.membresia.bodegaId, usuario.id, { empresaId, fecha, nota: String(formData.get("nota") ?? ""), lineas }, decision.membresia.rol);
    revalidatePath("/bodega/recepcion");
    revalidatePath("/bodega/inventario");
    destino = conMensaje(RUTA, "ok", "Recepción registrada y stock actualizado.");
  } catch (error) {
    if (!(error instanceof RecepcionInvalidaError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
