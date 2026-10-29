"use server";

import { usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import {
  ArchivoMaestraInvalidoError,
  confirmarImportacionMaestra,
  ImportacionMaestraConErroresError,
  ProveedorImportacionError,
  previsualizarImportacionMaestra,
  type ResultadoImportacionMaestra,
  type VistaPreviaMaestra,
} from "@/lib/finanzas/maestra-importar";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

// Issue #128 (Z-FIN-06) — llamadas directo desde ImportarMaestraClient,
// igual que /panel/sku/importar: hace falta la vista previa estructurada
// de vuelta. El archivo viaja dos veces (vista previa y confirmación) y
// el servidor lo vuelve a leer y validar entero en la segunda: nunca se
// confía en la lista de filas que mostró el navegador. requierePermiso
// se repite en lib/finanzas/maestra-importar.ts, para quien llame esas
// funciones sin pasar por acá.

export type EstadoImportacionMaestra =
  | { paso: "inicial" }
  | { paso: "error"; mensaje: string }
  | { paso: "revisar"; vistaPrevia: VistaPreviaMaestra }
  | { paso: "confirmado"; resultado: ResultadoImportacionMaestra };

async function leerEntrada(formData: FormData) {
  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) return null;
  const mapeoTexto = formData.get("mapeo");
  let mapeo: unknown = undefined;
  if (typeof mapeoTexto === "string" && mapeoTexto) {
    try {
      mapeo = JSON.parse(mapeoTexto);
    } catch {
      mapeo = {};
    }
  }
  return { archivo: { nombre: archivo.name, contenido: Buffer.from(await archivo.arrayBuffer()) }, mapeo };
}

function errorConocido(error: unknown): EstadoImportacionMaestra | null {
  if (error instanceof SinPermisoError) return { paso: "error", mensaje: "Tu rol no puede cargar la tabla maestra." };
  if (error instanceof ArchivoMaestraInvalidoError || error instanceof ProveedorImportacionError) return { paso: "error", mensaje: error.message };
  return null;
}

export async function previsualizarMaestraAction(formData: FormData): Promise<EstadoImportacionMaestra> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
    const entrada = await leerEntrada(formData);
    if (!entrada) return { paso: "error", mensaje: "Elige un archivo .xlsx o .csv." };
    const vistaPrevia = await previsualizarImportacionMaestra(empresaId, usuarioId, entrada.archivo, entrada.mapeo);
    return { paso: "revisar", vistaPrevia };
  } catch (error) {
    const estado = errorConocido(error);
    if (estado) return estado;
    throw error;
  }
}

export async function confirmarMaestraAction(formData: FormData): Promise<EstadoImportacionMaestra> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
    const entrada = await leerEntrada(formData);
    if (!entrada) return { paso: "error", mensaje: "No hay archivo para confirmar: vuelve a subirlo." };
    const resultado = await confirmarImportacionMaestra(empresaId, usuarioId, entrada.archivo, entrada.mapeo);
    return { paso: "confirmado", resultado };
  } catch (error) {
    // Alguien cambió la maestra o el archivo entre la vista previa y el
    // clic: se vuelve a mostrar la revisión con los errores de ahora.
    if (error instanceof ImportacionMaestraConErroresError) return { paso: "revisar", vistaPrevia: error.vista };
    const estado = errorConocido(error);
    if (estado) return estado;
    throw error;
  }
}
