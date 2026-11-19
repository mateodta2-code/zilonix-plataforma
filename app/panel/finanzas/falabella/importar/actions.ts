"use server";

import { revalidatePath } from "next/cache";
import { usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { importarReporteFalabella, ReporteFalabellaInvalidoError, type ResultadoImportacionReporte } from "@/lib/falabella/conciliacion";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

// Issue #422 — subir el «Reporte de transacciones» de Falabella. Pide
// finanzas.modificar acá y otra vez en lib/falabella/conciliacion.ts. No
// hay vista previa: reimportar no duplica (cada línea tiene su huella),
// así que guardar directo es seguro y el resultado dice qué entró.

export type EstadoImportacionReporte =
  | { paso: "inicial" }
  | { paso: "error"; mensaje: string }
  | { paso: "listo"; resultado: ResultadoImportacionReporte };

export async function importarReporteFalabellaAction(formData: FormData): Promise<EstadoImportacionReporte> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
    const archivo = formData.get("archivo");
    if (!(archivo instanceof File) || archivo.size === 0) return { paso: "error", mensaje: "Elige el archivo .xlsx del reporte." };
    const resultado = await importarReporteFalabella(empresaId, usuarioId, {
      nombre: archivo.name,
      contenido: Buffer.from(await archivo.arrayBuffer()),
    });
    revalidatePath("/panel/finanzas/falabella");
    return { paso: "listo", resultado };
  } catch (error) {
    if (error instanceof SinPermisoError) return { paso: "error", mensaje: "Tu rol no puede cargar reportes de Falabella." };
    if (error instanceof ReporteFalabellaInvalidoError) return { paso: "error", mensaje: error.message };
    throw error;
  }
}
