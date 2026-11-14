import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { dbSuperadmin } from "@/db/superadmin-context";
import { foroPreguntas, foroRespuestas, usuarios } from "@/db/schema";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { creaContador, limpiarVencidos, superaLimite } from "@/lib/limite-peticiones";
import { requiereSuperadmin } from "@/lib/superadmin";
import { ForoError, patronBusqueda, validarPregunta, validarRespuesta } from "@/lib/foro-validacion";

export { ForoError } from "@/lib/foro-validacion";

// Foro de la comunidad (14-nov) — compartido entre TODAS las empresas,
// a propósito sin dbComoEmpresa: foro_preguntas/foro_respuestas no
// tienen empresa_id (db/schema.ts). Lo único que se muestra de quien
// escribe es su nombre — nunca la empresa ni ningún dato de negocio.

// El foro no es de una empresa, pero sí es solo para quien usa Zilonix:
// alguien que se registró en Clerk y nunca creó ni se unió a ninguna
// empresa no lee ni escribe. Es el candado de toda ruta del foro (ver
// RUTAS_EXENTAS en scripts/verificar-permisos.test.ts).
export async function requiereMiembroDeAlgunaEmpresa(usuarioId: string): Promise<void> {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  if (propias.length === 0) throw new ForoError("El foro es para quienes ya tienen una empresa en Zilonix.");
}

// Freno contra spam (un bot o un copiar/pegar en bucle): 10
// publicaciones por persona cada 10 minutos, preguntas y respuestas
// juntas. Memoria del proceso, mismo criterio que lib/limite-peticiones.ts.
const VENTANA_PUBLICAR_MS = 10 * 60 * 1000;
const LIMITE_PUBLICAR = 10;
const publicacionesPorUsuario = creaContador();

function frenarSpam(usuarioId: string): void {
  if (publicacionesPorUsuario.size > 1000) limpiarVencidos(publicacionesPorUsuario, VENTANA_PUBLICAR_MS);
  if (superaLimite(publicacionesPorUsuario, usuarioId, LIMITE_PUBLICAR, VENTANA_PUBLICAR_MS)) {
    throw new ForoError("Publicaste muchas veces seguidas. Espera unos minutos y vuelve a intentar.");
  }
}

export type PreguntaResumen = {
  id: string;
  titulo: string;
  autorNombre: string;
  creadoTs: Date;
  respuestas: number;
};

export const TAMANO_PAGINA_FORO = 30;

export async function listarPreguntas(opciones: { busqueda?: string; limite?: number } = {}): Promise<PreguntaResumen[]> {
  const busqueda = opciones.busqueda?.trim().slice(0, 100);
  const filtro = busqueda
    ? and(isNull(foroPreguntas.ocultaTs), or(ilike(foroPreguntas.titulo, patronBusqueda(busqueda)), ilike(foroPreguntas.cuerpo, patronBusqueda(busqueda))))
    : isNull(foroPreguntas.ocultaTs);

  return db
    .select({
      id: foroPreguntas.id,
      titulo: foroPreguntas.titulo,
      autorNombre: usuarios.nombre,
      creadoTs: foroPreguntas.creadoTs,
      // Solo las respuestas visibles — una escondida por moderación no
      // cuenta, igual que no se muestra.
      respuestas: sql<number>`(select count(*) from ${foroRespuestas} where ${foroRespuestas.preguntaId} = ${foroPreguntas.id} and ${foroRespuestas.ocultaTs} is null)`.mapWith(Number),
    })
    .from(foroPreguntas)
    .innerJoin(usuarios, eq(usuarios.id, foroPreguntas.autorId))
    .where(filtro)
    .orderBy(desc(foroPreguntas.creadoTs))
    .limit(opciones.limite ?? TAMANO_PAGINA_FORO);
}

export type RespuestaForo = { id: string; cuerpo: string; autorNombre: string; creadoTs: Date };
export type PreguntaDetalle = {
  id: string;
  titulo: string;
  cuerpo: string;
  autorNombre: string;
  creadoTs: Date;
  respuestas: RespuestaForo[];
};

// null = no existe o está escondida: para quien no es superadmin, una
// pregunta escondida es igual que una que nunca existió.
export async function obtenerPregunta(preguntaId: string): Promise<PreguntaDetalle | null> {
  if (!esUuid(preguntaId)) return null;
  const [pregunta] = await db
    .select({
      id: foroPreguntas.id,
      titulo: foroPreguntas.titulo,
      cuerpo: foroPreguntas.cuerpo,
      autorNombre: usuarios.nombre,
      creadoTs: foroPreguntas.creadoTs,
    })
    .from(foroPreguntas)
    .innerJoin(usuarios, eq(usuarios.id, foroPreguntas.autorId))
    .where(and(eq(foroPreguntas.id, preguntaId), isNull(foroPreguntas.ocultaTs)));
  if (!pregunta) return null;

  const respuestas = await db
    .select({ id: foroRespuestas.id, cuerpo: foroRespuestas.cuerpo, autorNombre: usuarios.nombre, creadoTs: foroRespuestas.creadoTs })
    .from(foroRespuestas)
    .innerJoin(usuarios, eq(usuarios.id, foroRespuestas.autorId))
    .where(and(eq(foroRespuestas.preguntaId, preguntaId), isNull(foroRespuestas.ocultaTs)))
    .orderBy(asc(foroRespuestas.creadoTs));

  return { ...pregunta, respuestas };
}

export async function crearPregunta(autorId: string, titulo: unknown, cuerpo: unknown): Promise<string> {
  const datos = validarPregunta(titulo, cuerpo);
  await requiereMiembroDeAlgunaEmpresa(autorId);
  frenarSpam(autorId);
  const [fila] = await db.insert(foroPreguntas).values({ autorId, ...datos }).returning({ id: foroPreguntas.id });
  return fila.id;
}

export async function crearRespuesta(autorId: string, preguntaId: string, cuerpo: unknown): Promise<void> {
  const texto = validarRespuesta(cuerpo);
  await requiereMiembroDeAlgunaEmpresa(autorId);
  if (!esUuid(preguntaId)) throw new ForoError("Esa pregunta ya no está disponible.");
  const [pregunta] = await db
    .select({ id: foroPreguntas.id })
    .from(foroPreguntas)
    .where(and(eq(foroPreguntas.id, preguntaId), isNull(foroPreguntas.ocultaTs)));
  if (!pregunta) throw new ForoError("Esa pregunta ya no está disponible.");
  frenarSpam(autorId);
  await db.insert(foroRespuestas).values({ preguntaId, autorId, cuerpo: texto });
}

function esUuid(valor: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(valor);
}

// ── Moderación (solo superadmin) ──────────────────────────────────────
//
// Con dbSuperadmin, nunca con db: superadmin_user puede ver lo
// escondido y marcar oculta_ts/oculta_por, nada más (db/rls-setup.sql).

export type PublicacionParaModerar = {
  tipo: "pregunta" | "respuesta";
  id: string;
  preguntaId: string;
  titulo: string;
  cuerpo: string;
  autorNombre: string;
  autorEmail: string;
  creadoTs: Date;
  ocultaTs: Date | null;
};

export async function listarParaModerar(superadminUsuarioId: string, limite = 100): Promise<PublicacionParaModerar[]> {
  await requiereSuperadmin(superadminUsuarioId);

  const preguntas = await dbSuperadmin
    .select({
      id: foroPreguntas.id,
      titulo: foroPreguntas.titulo,
      cuerpo: foroPreguntas.cuerpo,
      autorNombre: usuarios.nombre,
      autorEmail: usuarios.email,
      creadoTs: foroPreguntas.creadoTs,
      ocultaTs: foroPreguntas.ocultaTs,
    })
    .from(foroPreguntas)
    .innerJoin(usuarios, eq(usuarios.id, foroPreguntas.autorId))
    .orderBy(desc(foroPreguntas.creadoTs))
    .limit(limite);

  const respuestas = await dbSuperadmin
    .select({
      id: foroRespuestas.id,
      preguntaId: foroRespuestas.preguntaId,
      titulo: foroPreguntas.titulo,
      cuerpo: foroRespuestas.cuerpo,
      autorNombre: usuarios.nombre,
      autorEmail: usuarios.email,
      creadoTs: foroRespuestas.creadoTs,
      ocultaTs: foroRespuestas.ocultaTs,
    })
    .from(foroRespuestas)
    .innerJoin(foroPreguntas, eq(foroPreguntas.id, foroRespuestas.preguntaId))
    .innerJoin(usuarios, eq(usuarios.id, foroRespuestas.autorId))
    .orderBy(desc(foroRespuestas.creadoTs))
    .limit(limite);

  return [
    ...preguntas.map((p) => ({ ...p, tipo: "pregunta" as const, preguntaId: p.id })),
    ...respuestas.map((r) => ({ ...r, tipo: "respuesta" as const })),
  ]
    .sort((a, b) => b.creadoTs.getTime() - a.creadoTs.getTime())
    .slice(0, limite);
}

// ocultar=false vuelve a mostrarla (un error de moderación se deshace;
// nunca se borra nada).
export async function cambiarVisibilidad(
  superadminUsuarioId: string,
  tipo: "pregunta" | "respuesta",
  id: string,
  ocultar: boolean
): Promise<void> {
  await requiereSuperadmin(superadminUsuarioId);
  if (!esUuid(id)) throw new ForoError("Publicación no encontrada.");
  const valores = ocultar ? { ocultaTs: new Date(), ocultaPor: superadminUsuarioId } : { ocultaTs: null, ocultaPor: null };
  const filas =
    tipo === "pregunta"
      ? await dbSuperadmin.update(foroPreguntas).set(valores).where(eq(foroPreguntas.id, id)).returning({ id: foroPreguntas.id })
      : await dbSuperadmin.update(foroRespuestas).set(valores).where(eq(foroRespuestas.id, id)).returning({ id: foroRespuestas.id });
  if (filas.length === 0) throw new ForoError("Publicación no encontrada.");
}
