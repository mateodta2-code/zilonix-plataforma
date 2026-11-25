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
import type { SaludEmpresa } from "@/lib/superadmin-salud";
import type { EstadoProceso } from "@/lib/superadmin-procesos";
import type { Proceso } from "@/lib/trabajos/registroEjecuciones";

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

export const PLANES = ["prueba", "basico", "pro", "empresarial"] as const;
export type Plan = (typeof PLANES)[number];
export const ESTADOS_EMPRESA = ["activa", "suspendida"] as const;
export type EstadoEmpresa = (typeof ESTADOS_EMPRESA)[number];

export type EmpresaConConteo = {
  id: string;
  nombre: string;
  nit: string;
  creadoTs: Date;
  plan: Plan;
  estado: EstadoEmpresa;
  suspendidaMotivo: string | null;
  suspendidaTs: Date | null;
  notasInternas: string | null;
  miembros: number;
  cuentasMl: number;
  cuentasFalabella: number;
  ultimaActividad: Date | null;
  ultimoIngresoTs: Date | null;
};

// Lo único que el superadmin ve SIEMPRE, sin pedir nada a nadie: las
// cifras agregadas (decisión D8). Los conteos de cuentas y la última
// actividad salen de superadmin_resumen_empresas() (db/rls-setup.sql, SECURITY
// DEFINER): superadmin_user no tiene SELECT sobre cuentas_ml, cuentas_falabella
// ni auditoria, así que la base solo le entrega números y una fecha.
export async function listarEmpresasConConteo(): Promise<EmpresaConConteo[]> {
  const filas = await dbSuperadmin.select().from(empresas);
  const resumen = (await dbSuperadmin.execute(sql`select * from superadmin_resumen_empresas()`)) as unknown as {
    empresa_id: string;
    miembros: string | number;
    cuentas_ml: string | number;
    cuentas_falabella: string | number;
    ultima_actividad: Date | string | null;
  }[];
  const porEmpresa = new Map(resumen.map((r) => [r.empresa_id, r]));
  return filas
    .map((e) => {
      const r = porEmpresa.get(e.id);
      return {
        id: e.id,
        nombre: e.nombre,
        nit: e.nit,
        creadoTs: e.creadoTs,
        plan: e.plan as Plan,
        estado: e.estado as EstadoEmpresa,
        suspendidaMotivo: e.suspendidaMotivo,
        suspendidaTs: e.suspendidaTs,
        notasInternas: e.notasInternas,
        miembros: Number(r?.miembros ?? 0),
        cuentasMl: Number(r?.cuentas_ml ?? 0),
        cuentasFalabella: Number(r?.cuentas_falabella ?? 0),
        ultimaActividad: r?.ultima_actividad ? new Date(r.ultima_actividad) : null,
        ultimoIngresoTs: e.ultimoIngresoTs,
      };
    })
    .sort((a, b) => b.creadoTs.getTime() - a.creadoTs.getTime());
}

// Salud de conexiones (25-nov, /superadmin/conexiones): solo conteos por
// empresa vía superadmin_salud_conexiones() (db/rls-setup.sql, SECURITY
// DEFINER) — superadmin_user no tiene SELECT sobre cuentas_ml, avisos_ml
// ni publicidad_sincronizaciones, y no se le da.
export async function listarSaludConexiones(): Promise<SaludEmpresa[]> {
  const lista = await dbSuperadmin.select({ id: empresas.id, nombre: empresas.nombre, estado: empresas.estado }).from(empresas);
  const conteos = (await dbSuperadmin.execute(sql`select * from superadmin_salud_conexiones()`)) as unknown as {
    empresa_id: string;
    ml_conectadas: string | number;
    ml_desconectadas: string | number;
    ml_sin_renovar: string | number;
    avisos_atrasados: string | number;
    publicidad_con_error: string | number;
    falabella_desconectadas: string | number;
  }[];
  const porEmpresa = new Map(conteos.map((c) => [c.empresa_id, c]));
  return lista.map((e) => {
    const c = porEmpresa.get(e.id);
    return {
      empresaId: e.id,
      nombre: e.nombre,
      estado: e.estado,
      mlConectadas: Number(c?.ml_conectadas ?? 0),
      mlDesconectadas: Number(c?.ml_desconectadas ?? 0),
      mlSinRenovar: Number(c?.ml_sin_renovar ?? 0),
      avisosAtrasados: Number(c?.avisos_atrasados ?? 0),
      publicidadConError: Number(c?.publicidad_con_error ?? 0),
      falabellaDesconectadas: Number(c?.falabella_desconectadas ?? 0),
    };
  });
}

// Estado de los procesos (25-nov): última corrida de cada proceso
// automático y la cola de avisos, vía funciones SECURITY DEFINER
// (superadmin_user no lee ejecuciones_procesos ni avisos_ml directo).
export async function listarEstadoProcesos(): Promise<EstadoProceso[]> {
  const filas = (await dbSuperadmin.execute(sql`select * from superadmin_estado_procesos()`)) as unknown as {
    proceso: Proceso;
    ultima_ts: string | Date | null;
    ultima_ok: boolean | null;
    ultimo_resumen: Record<string, number> | null;
    ultimo_error: string | null;
    ultima_exitosa_ts: string | Date | null;
    corridas_24h: string | number;
    fallidas_24h: string | number;
  }[];
  const fecha = (v: string | Date | null) => (v ? new Date(v) : null);
  return filas.map((f) => ({
    proceso: f.proceso,
    ultimaTs: fecha(f.ultima_ts),
    ultimaOk: f.ultima_ok,
    ultimoResumen: f.ultimo_resumen ?? {},
    ultimoError: f.ultimo_error,
    ultimaExitosaTs: fecha(f.ultima_exitosa_ts),
    corridas24h: Number(f.corridas_24h),
    fallidas24h: Number(f.fallidas_24h),
  }));
}

export async function avisosEnCola(): Promise<{ pendientes: number; atrasados: number }> {
  const [f] = (await dbSuperadmin.execute(sql`select * from superadmin_avisos_en_cola()`)) as unknown as { pendientes: string | number; atrasados: string | number }[];
  return { pendientes: Number(f?.pendientes ?? 0), atrasados: Number(f?.atrasados ?? 0) };
}

export type AccionSuperadmin = { ts: Date; accion: string; entidad: string; empresaNombre: string | null; detalle: string | null };

// Últimas acciones hechas por cuentas superadmin. superadmin_user NO tiene
// SELECT sobre auditoria (solo INSERT): la lectura pasa por
// superadmin_acciones_recientes() (db/rls-setup.sql, SECURITY DEFINER), que
// solo devuelve filas cuyo autor es superadmin y solo estas 5 columnas.
export async function listarAccionesSuperadmin(limite = 100): Promise<AccionSuperadmin[]> {
  const filas = (await dbSuperadmin.execute(sql`select * from superadmin_acciones_recientes(${limite})`)) as unknown as {
    ts: Date | string;
    accion: string;
    entidad: string;
    empresa_nombre: string | null;
    detalle: string | null;
  }[];
  return filas.map((f) => ({ ts: new Date(f.ts), accion: f.accion, entidad: f.entidad, empresaNombre: f.empresa_nombre, detalle: f.detalle }));
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
