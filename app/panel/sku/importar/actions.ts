"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { SinPermisoError } from "@/lib/permisos";
import {
  confirmarImportacionSkus,
  previsualizarImportacionSkus,
  SinFilasValidasError,
  type ResultadoConfirmarImportacion,
  type VistaPreviaImportacionSku,
} from "@/lib/ml/sku-importar";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

export type EstadoImportacion =
  | { paso: "inicial" }
  | { paso: "error"; mensaje: string }
  | { paso: "revisar"; csvTexto: string; vistaPrevia: VistaPreviaImportacionSku }
  | { paso: "confirmado"; resultado: ResultadoConfirmarImportacion };

// Llamados directo desde el componente cliente (ImportarCsvSkusClient),
// no con un <form action={...}> normal: necesitamos el resultado
// estructurado (filas, errores, resumen) de vuelta para pintar la
// vista previa antes de confirmar, y este proyecto todavía está en
// React 18.3.1 (sin useActionState/useFormState — son de React 19).
// Una Server Action sigue siendo una función normal que se puede
// llamar así, await de por medio; Next la sigue tratando como RPC real.
export async function previsualizarImportacionAction(formData: FormData): Promise<EstadoImportacion> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);

  const archivo = formData.get("archivo");
  if (!(archivo instanceof File) || archivo.size === 0) {
    return { paso: "error", mensaje: "Elige un archivo CSV para subir." };
  }

  // El tamaño/número de filas del archivo se vuelve a validar DENTRO
  // de previsualizarImportacionSkus (lib/importar-csv-skus.ts) sobre
  // este mismo texto — nunca se confía en archivo.size ni en nada que
  // mande el navegador antes de eso.
  const csvTexto = await archivo.text();

  try {
    const vistaPrevia = await previsualizarImportacionSkus(empresa.id, usuario.id, csvTexto);
    return { paso: "revisar", csvTexto, vistaPrevia };
  } catch (error) {
    if (error instanceof SinPermisoError) return { paso: "error", mensaje: "Tu rol no puede importar SKUs." };
    throw error;
  }
}

// Recibe el TEXTO ya leído (reenviado en un campo oculto desde el paso
// de revisión), no "la lista de filas válidas" que armó la vista
// previa — confirmarImportacionSkus() vuelve a parsear y validar todo
// desde cero sobre ese texto, nunca confía en qué filas dijo el
// navegador que eran válidas.
export async function confirmarImportacionAction(formData: FormData): Promise<EstadoImportacion> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);

  const csvTexto = String(formData.get("csvTexto") ?? "");
  if (!csvTexto) return { paso: "error", mensaje: "No hay nada para confirmar — vuelve a subir el archivo." };

  try {
    const resultado = await confirmarImportacionSkus(empresa.id, usuario.id, csvTexto);
    return { paso: "confirmado", resultado };
  } catch (error) {
    if (error instanceof SinPermisoError) return { paso: "error", mensaje: "Tu rol no puede importar SKUs." };
    if (error instanceof SinFilasValidasError) return { paso: "error", mensaje: error.message };
    throw error;
  }
}
