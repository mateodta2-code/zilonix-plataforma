import { obtenerConexionIAConClavePorId } from "./conexion";
import { ErrorProveedorIA, llamarIA } from "./proveedores";

export type ResultadoProbarIA = { ok: true } | { ok: false; error: string };

export const ERRORES_PROBAR_IA = {
  llave: "La llave no es válida o no tiene permiso.",
  modelo: "El modelo no existe para esta cuenta.",
  tiempo: "La IA no respondió a tiempo.",
  noEncontrada: "No se encontró esa conexión.",
  generico: "No se pudo probar la conexión.",
} as const;

// Una llamada mínima con ESA conexión. Mensajes FIJOS: nunca el texto
// crudo del proveedor ni la key.
export async function probarConexionIA(empresaId: string, id: string): Promise<ResultadoProbarIA> {
  const conexion = await obtenerConexionIAConClavePorId(empresaId, id);
  if (!conexion) return { ok: false, error: ERRORES_PROBAR_IA.noEncontrada };
  try {
    await llamarIA(conexion, "Responde solo: ok", { maxTokens: 16 });
    return { ok: true };
  } catch (error) {
    if (error instanceof ErrorProveedorIA) {
      const estado = Number(/\((\d{3})\)/.exec(error.message)?.[1]);
      if (estado === 401 || estado === 403) return { ok: false, error: ERRORES_PROBAR_IA.llave };
      if (estado === 404) return { ok: false, error: ERRORES_PROBAR_IA.modelo };
      if (/a tiempo/.test(error.message)) return { ok: false, error: ERRORES_PROBAR_IA.tiempo };
    }
    return { ok: false, error: ERRORES_PROBAR_IA.generico };
  }
}
