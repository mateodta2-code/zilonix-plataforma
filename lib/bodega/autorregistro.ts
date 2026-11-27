import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { dbComoAutorregistroBodega, dbComoUsuarioBodega } from "@/db/bodega-context";
import { bodegas3pl, miembrosBodega3pl, sedesBodega } from "@/db/schema";
import { creaContador, superaLimite } from "@/lib/limite-peticiones";
import { registrarAuditoriaBodega } from "./auditoria";
import { SedeBodegaError, esChoqueUnico, validarDatosSede, type DatosSede } from "./sedes";

export class AutorregistroBodegaError extends Error {}

export const NOMBRE_SEDE_POR_DEFECTO = "Sede principal";
export const MENSAJE_YA_REGISTRADA = "Ya registraste una bodega con esta cuenta.";

// Límite del endpoint público: por persona y por IP, ventana de una hora.
// En memoria del proceso (mismo criterio que lib/limite-peticiones.ts).
export const VENTANA_AUTORREGISTRO_MS = 60 * 60 * 1000;
export const MAX_INTENTOS_POR_USUARIO = 5;
export const MAX_INTENTOS_POR_IP = 20;
const contadorPorUsuario = creaContador();
const contadorPorIp = creaContador();

// true = se superó el límite: no se crea nada. Cuenta cada intento (también
// los que fallan por validación), así adivinar o insistir se frena igual.
export function superaLimiteAutorregistro(usuarioId: string, ip: string, ahoraMs: number = Date.now()): boolean {
  const porUsuario = superaLimite(contadorPorUsuario, usuarioId, MAX_INTENTOS_POR_USUARIO, VENTANA_AUTORREGISTRO_MS, ahoraMs);
  const porIp = superaLimite(contadorPorIp, ip, MAX_INTENTOS_POR_IP, VENTANA_AUTORREGISTRO_MS, ahoraMs);
  return porUsuario || porIp;
}

// Solo para pruebas.
export function reiniciarLimitesAutorregistro() {
  contadorPorUsuario.clear();
  contadorPorIp.clear();
}

export type DatosAutorregistro = { nombre: string; nit?: string; sede: DatosSede };

// ¿Esta persona ya creó una bodega autorregistrada? (para /bodega/crear)
export async function yaCreoBodegaAutorregistrada(usuarioId: string): Promise<boolean> {
  return dbComoUsuarioBodega(usuarioId, async (tx) => {
    const filas = await tx
      .select({ id: bodegas3pl.id })
      .from(bodegas3pl)
      .innerJoin(miembrosBodega3pl, eq(miembrosBodega3pl.bodegaId, bodegas3pl.id))
      .where(and(eq(bodegas3pl.creadoPor, usuarioId), eq(bodegas3pl.origen, "autorregistro"), eq(miembrosBodega3pl.usuarioId, usuarioId)))
      .limit(1);
    return filas.length > 0;
  });
}

// Crea la bodega, su admin, su primera sede y la auditoría en UNA transacción.
// Devuelve el id de la bodega. Tener empresa de vendedor o perfil de
// domiciliario no bloquea: solo una bodega autorregistrada por persona.
export async function crearBodegaAutorregistro(usuarioId: string, datos: DatosAutorregistro): Promise<{ bodegaId: string }> {
  const nombre = (datos.nombre ?? "").trim();
  const nit = (datos.nit ?? "").trim();
  if (nombre.length < 2 || nombre.length > 80) throw new AutorregistroBodegaError("El nombre de la bodega debe tener entre 2 y 80 caracteres.");
  if (nit.length > 40) throw new AutorregistroBodegaError("El NIT es demasiado largo (máximo 40 caracteres).");
  let sede;
  try {
    sede = validarDatosSede({ ...datos.sede, nombre: datos.sede.nombre?.trim() ? datos.sede.nombre : NOMBRE_SEDE_POR_DEFECTO });
  } catch (error) {
    if (error instanceof SedeBodegaError) throw new AutorregistroBodegaError(error.message);
    throw error;
  }

  const bodegaId = randomUUID();
  const sedeId = randomUUID();
  try {
    await dbComoAutorregistroBodega(usuarioId, bodegaId, async (tx) => {
      await tx.insert(bodegas3pl).values({ id: bodegaId, nombre, nit: nit || null, estado: "activa", origen: "autorregistro", creadoPor: usuarioId });
      await tx.insert(miembrosBodega3pl).values({ id: randomUUID(), bodegaId, usuarioId, rol: "admin_bodega", activo: true });
      await tx.insert(sedesBodega).values({ id: sedeId, bodegaId, ...sede });
      await registrarAuditoriaBodega(tx, { bodegaId, usuarioId, accion: "bodega_autorregistro", entidad: "bodega_3pl", entidadId: bodegaId, valorNuevo: nombre, detalle: "Registró su bodega." });
      await registrarAuditoriaBodega(tx, { bodegaId, usuarioId, accion: "sede_creada", entidad: "sede_bodega", entidadId: sedeId, valorNuevo: sede.nombre, detalle: "Creó la primera sede." });
    });
  } catch (error) {
    if (esChoqueUnico(error)) throw new AutorregistroBodegaError(MENSAJE_YA_REGISTRADA);
    throw error;
  }
  return { bodegaId };
}
