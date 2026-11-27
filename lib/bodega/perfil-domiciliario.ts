import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { dbComoUsuarioBodega } from "@/db/bodega-context";
import { auditoria, perfilesDomiciliario } from "@/db/schema";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";

export class PerfilDomiciliarioError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "PerfilDomiciliarioError";
  }
}

export type DatosPerfilDomiciliario = { nombre: string; telefono?: string | null; ciudad?: string | null };

const MAX_NOMBRE = 120;
const MAX_TELEFONO = 30;
const MAX_CIUDAD = 80;

// Límite del endpoint público nuevo (punto de auditoría 7): contador propio,
// en memoria como el resto de lib/limite-peticiones.ts. Un domiciliario real
// crea su perfil una sola vez; 5 por persona y 20 por IP por hora frenan el
// abuso sin molestar a varias personas detrás de una misma red.
const VENTANA_MS = 60 * 60 * 1000;
const LIMITE_POR_USUARIO = 5;
const LIMITE_POR_IP = 20;
export const contadorPorUsuario = creaContador();
export const contadorPorIp = creaContador();

export function frenarAutorregistroDomiciliario(usuarioId: string, ip: string, ahoraMs: number = Date.now()): void {
  if (contadorPorUsuario.size > 1000) limpiarVencidos(contadorPorUsuario, VENTANA_MS, ahoraMs);
  if (contadorPorIp.size > 1000) limpiarVencidos(contadorPorIp, VENTANA_MS, ahoraMs);
  // Se evalúan los dos para que ambos cuenten el intento.
  const porUsuario = superaLimite(contadorPorUsuario, usuarioId, LIMITE_POR_USUARIO, VENTANA_MS, ahoraMs);
  const porIp = superaLimite(contadorPorIp, ip, LIMITE_POR_IP, VENTANA_MS, ahoraMs);
  if (porUsuario || porIp) throw new PerfilDomiciliarioError("Hiciste muchos intentos seguidos. Espera un rato y vuelve a intentar.");
}

export function validarDatosPerfil(datos: DatosPerfilDomiciliario): { nombre: string; telefono: string | null; ciudad: string | null } {
  const nombre = (datos.nombre ?? "").trim();
  const telefono = (datos.telefono ?? "").trim();
  const ciudad = (datos.ciudad ?? "").trim();
  if (!nombre) throw new PerfilDomiciliarioError("El nombre es obligatorio.");
  if (nombre.length > MAX_NOMBRE) throw new PerfilDomiciliarioError(`El nombre admite hasta ${MAX_NOMBRE} caracteres.`);
  if (telefono.length > MAX_TELEFONO) throw new PerfilDomiciliarioError(`El teléfono admite hasta ${MAX_TELEFONO} caracteres.`);
  if (ciudad.length > MAX_CIUDAD) throw new PerfilDomiciliarioError(`La ciudad admite hasta ${MAX_CIUDAD} caracteres.`);
  return { nombre, telefono: telefono || null, ciudad: ciudad || null };
}

// ¿Esta persona ya tiene perfil? RLS: solo puede ver el propio.
export async function tienePerfilDomiciliario(usuarioId: string): Promise<boolean> {
  return dbComoUsuarioBodega(usuarioId, async (tx) => {
    const [fila] = await tx.select({ id: perfilesDomiciliario.id }).from(perfilesDomiciliario).where(eq(perfilesDomiciliario.usuarioId, usuarioId)).limit(1);
    return Boolean(fila);
  });
}

// Autorregistro: perfil + auditoría en la MISMA transacción. El teléfono no
// se escribe en claro en el detalle de auditoría (solo si se dio o no).
export async function crearPerfilDomiciliario(usuarioId: string, datos: DatosPerfilDomiciliario): Promise<{ id: string }> {
  const limpios = validarDatosPerfil(datos);
  const id = randomUUID();
  try {
    await dbComoUsuarioBodega(usuarioId, async (tx) => {
      const [existente] = await tx.select({ id: perfilesDomiciliario.id }).from(perfilesDomiciliario).where(eq(perfilesDomiciliario.usuarioId, usuarioId)).limit(1);
      if (existente) throw new PerfilDomiciliarioError("Ya tienes un perfil de domiciliario.");
      await tx.insert(perfilesDomiciliario).values({ id, usuarioId, ...limpios });
      await tx.insert(auditoria).values({
        id: randomUUID(),
        bodegaId: null,
        empresaId: null,
        usuarioId,
        actorTipo: "persona",
        accion: "domiciliario_autorregistro",
        entidad: "perfil_domiciliario",
        entidadId: id,
        detalle: `Perfil de domiciliario creado${limpios.telefono ? " (con teléfono)" : ""}${limpios.ciudad ? " (con ciudad)" : ""}.`,
      });
    });
  } catch (error) {
    // 23505 = dos envíos simultáneos: el índice único por usuario gana.
    if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new PerfilDomiciliarioError("Ya tienes un perfil de domiciliario.");
    throw error;
  }
  return { id };
}
