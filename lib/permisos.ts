import { obtenerMiMembresia, type MiMembresia } from "@/lib/membresias";
import { tienePermiso, type Accion, type Modulo } from "@/lib/roles";

export class SinPermisoError extends Error {
  constructor(modulo: Modulo, accion: Accion) {
    super(`No tienes permiso para "${accion}" en "${modulo}".`);
    this.name = "SinPermisoError";
  }
}

// Tarea 1.8 — la ÚNICA función que toda ruta de negocio debe llamar
// antes de leer o escribir algo de una empresa: "¿este usuario puede
// [accion] en [modulo] de esta empresa?". Las tareas 1.6 y 1.7 hacían
// esta pregunta a mano, cada pantalla con su propio candado
// provisional ("solo el Dueño puede...") — acá se vuelve una sola
// función, y scripts/verificar-permisos.test.ts hace fallar el CI si
// una ruta que toca datos de negocio no la llama.
//
// Lanza SinPermisoError (nunca devuelve false en silencio) — una ruta
// que no la captura deja que el error.tsx de su carpeta muestre el
// mensaje; una que quiere un mensaje propio la captura con try/catch.
export async function requierePermiso(
  usuarioId: string,
  empresaId: string,
  modulo: Modulo,
  accion: Accion
): Promise<MiMembresia> {
  const miMembresia = await obtenerMiMembresia(usuarioId, empresaId);
  if (!miMembresia || !tienePermiso(miMembresia.permisos, modulo, accion)) {
    throw new SinPermisoError(modulo, accion);
  }
  return miMembresia;
}
