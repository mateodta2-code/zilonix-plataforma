import { randomUUID } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { currentUser } from "@clerk/nextjs/server";
import { eq, sql } from "drizzle-orm";
import {
  NOMBRE_COOKIE_SUPERADMIN,
  correoEstaAutorizado,
  parsearCorreosSuperadmin,
  verificarCookieSuperadmin,
} from "@/lib/superadmin-sesion";
import { db } from "@/db";
import { dbSuperadmin } from "@/db/superadmin-context";
import { accesosTemporales, auditoria, empresas, membresias, roles, usuarios } from "@/db/schema";

export class NoEsSuperadminError extends Error {
  constructor() {
    super("Esta cuenta no es superadmin.");
    this.name = "NoEsSuperadminError";
  }
}

export class SinAccesoTemporalError extends Error {
  constructor() {
    super("Esta empresa no tiene un acceso temporal activo — pídele que te conceda uno desde /panel/soporte.");
    this.name = "SinAccesoTemporalError";
  }
}

// Tarea 1.11 — la única función que toda ruta de /superadmin usa para
// preguntar "¿esta cuenta es superadmin?", igual de única que
// requierePermiso() en la tarea 1.8. `usuarios` no tiene RLS (tarea
// 1.3) así que esto se consulta con la conexión normal (`db`), sin
// necesitar ninguna de las dos conexiones especiales.
export async function requiereSuperadmin(usuarioId: string): Promise<void> {
  const [fila] = await db.select({ esSuperadmin: usuarios.esSuperadmin }).from(usuarios).where(eq(usuarios.id, usuarioId));
  if (!fila?.esSuperadmin) throw new NoEsSuperadminError();
}

export type EmpresaConConteo = { id: string; nombre: string; nit: string; creadoTs: Date; miembros: number };

// Lo único que el superadmin ve SIEMPRE, sin pedir nada a nadie: las
// cifras agregadas (decisión D8). Hoy "agregado" es cuántos miembros
// tiene cada empresa — no hay todavía ventas/pedidos reales (llegan
// en Fase 2); cuando lleguen, se suman a esta misma lista sin cambiar
// el mecanismo.
export async function listarEmpresasConConteo(): Promise<EmpresaConConteo[]> {
  return dbSuperadmin
    .select({
      id: empresas.id,
      nombre: empresas.nombre,
      nit: empresas.nit,
      creadoTs: empresas.creadoTs,
      miembros: sql<number>`count(${membresias.id})`.mapWith(Number),
    })
    .from(empresas)
    .leftJoin(membresias, eq(membresias.empresaId, empresas.id))
    .groupBy(empresas.id, empresas.nombre, empresas.nit, empresas.creadoTs);
}

export type MiembroDeEmpresa = { nombre: string; email: string; rolNombre: string };

// El "detalle" que SÍ exige el acceso temporal explícito de la
// empresa — nunca se consulta sin comprobar antes que existe uno
// activo, y cada vista exitosa queda escrita en auditoria (nunca
// legible de vuelta por el propio superadmin: superadmin_user solo
// tiene INSERT en auditoria, ver db/rls-setup.sql).
export async function obtenerMiembrosConAcceso(empresaId: string, superadminUsuarioId: string): Promise<MiembroDeEmpresa[]> {
  const ahora = Date.now();
  const accesos = await dbSuperadmin.select().from(accesosTemporales).where(eq(accesosTemporales.empresaId, empresaId));
  const accesoValido = accesos.find((a) => !a.revocadoTs && a.expiraTs.getTime() > ahora);
  if (!accesoValido) throw new SinAccesoTemporalError();

  const filas = await dbSuperadmin
    .select({ nombre: usuarios.nombre, email: usuarios.email, rolNombre: roles.nombre })
    .from(membresias)
    .innerJoin(usuarios, eq(membresias.usuarioId, usuarios.id))
    .innerJoin(roles, eq(membresias.rolId, roles.id))
    .where(eq(membresias.empresaId, empresaId));

  await dbSuperadmin.insert(auditoria).values({
    id: randomUUID(),
    empresaId,
    usuarioId: superadminUsuarioId,
    actorTipo: "persona",
    accion: "ver_detalle_superadmin",
    entidad: "miembros",
    detalle: `Vio el detalle de miembros amparado en el acceso temporal "${accesoValido.alcance}".`,
  });

  return filas;
}

export const RUTA_LOGIN_SUPERADMIN = "/superadmin/iniciar-sesion";

export type MotivoRechazoSuperadmin = "cerrado" | "no-autorizado" | "2fa" | "sin-sesion";

export type AccesoSuperadmin =
  | { ok: true; usuarioId: string; clerkUserId: string }
  | { ok: false; motivo: MotivoRechazoSuperadmin };

// Los chequeos de ENTRADA (sin mirar la cookie). Nunca crea filas:
// un correo fuera de la lista ni siquiera llega a consultar `usuarios`,
// y aunque llegara, acá solo se lee — jamás obtenerOCrearUsuarioActual().
// Cerrado por defecto: sin SUPERADMIN_SESION_SECRETO o sin lista, nadie entra.
export async function evaluarAccesoSuperadmin(): Promise<AccesoSuperadmin> {
  if (!process.env.SUPERADMIN_SESION_SECRETO) return { ok: false, motivo: "cerrado" };
  const lista = parsearCorreosSuperadmin(process.env.SUPERADMIN_CORREOS);
  if (lista.length === 0) return { ok: false, motivo: "cerrado" };

  const clerkUser = await currentUser();
  if (!clerkUser) return { ok: false, motivo: "sin-sesion" };

  // Solo el correo PRINCIPAL y solo si Clerk lo marca verificado.
  const principal = clerkUser.primaryEmailAddress;
  if (!principal || principal.verification?.status !== "verified" || !correoEstaAutorizado(principal.emailAddress, lista)) {
    return { ok: false, motivo: "no-autorizado" };
  }

  const [fila] = await db
    .select({ id: usuarios.id, esSuperadmin: usuarios.esSuperadmin })
    .from(usuarios)
    .where(eq(usuarios.clerkUserId, clerkUser.id));
  if (!fila?.esSuperadmin) return { ok: false, motivo: "no-autorizado" };

  // 2FA: apagado por defecto. No activa nada de pago en Clerk, solo
  // exige que la cuenta ya lo tenga.
  if (process.env.SUPERADMIN_EXIGIR_2FA === "true" && !clerkUser.twoFactorEnabled) {
    return { ok: false, motivo: "2fa" };
  }

  return { ok: true, usuarioId: fila.id, clerkUserId: clerkUser.id };
}

// La ÚNICA función que protege toda ruta de /superadmin (páginas y
// server actions). Exige chequeos de entrada + cookie propia
// "zx_superadmin" firmada y emitida para este mismo usuario de Clerk.
// Sin eso, redirige al login aparte (nunca a /sign-in ni a /panel).
export async function requiereSesionSuperadmin(): Promise<{ usuarioId: string; clerkUserId: string }> {
  const acceso = await evaluarAccesoSuperadmin();
  if (!acceso.ok) {
    redirect(acceso.motivo === "sin-sesion" ? RUTA_LOGIN_SUPERADMIN : `${RUTA_LOGIN_SUPERADMIN}?motivo=${acceso.motivo}`);
  }
  const valor = cookies().get(NOMBRE_COOKIE_SUPERADMIN)?.value;
  const valida = await verificarCookieSuperadmin(valor, acceso.clerkUserId, Date.now(), process.env.SUPERADMIN_SESION_SECRETO);
  if (!valida) redirect(RUTA_LOGIN_SUPERADMIN);
  return { usuarioId: acceso.usuarioId, clerkUserId: acceso.clerkUserId };
}
