// Publicar → «Crear con IA» (PR2) — historial y COLA de imágenes por
// empresa, en la base (publicaciones_ia_trabajos / _imagenes, migración
// 0034). Sin límite por hora, día ni mes (decisión de Mateo): solo un
// máximo de imágenes «generando» a la vez por empresa, para proteger el
// servidor. La que no tiene cupo queda «aprobada» (en cola) y la
// pantalla la vuelve a pedir sola cada pocos segundos hasta que entra.
// Una «generando» de más de 5 minutos se da por caída («error»), para que
// nunca trabe la cola.

import { and, eq, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { publicacionesIaImagenes, publicacionesIaTrabajos } from "@/db/schema";

export const MAXIMO_GENERANDO_POR_EMPRESA = 2;
export const MINUTOS_GENERANDO_ATASCADA = 5;

export type EstadoImagenIA = "propuesta" | "aprobada" | "generando" | "lista" | "error";

export async function crearTrabajoIA(
  empresaId: string,
  datos: { usuarioId: string; cuentaMlId: string | null; siteId: string; estilo: string; ficha: unknown; proveedor: string; modelo: string }
): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicacionesIaTrabajos)
      .values({ empresaId, ...datos, ficha: datos.ficha as Record<string, unknown> })
      .returning({ id: publicacionesIaTrabajos.id })
  );
  return fila.id;
}

export async function crearImagenesIA(
  empresaId: string,
  trabajoId: string,
  imagenes: { tipo: string; orden: number; cuentaMlId?: string | null; propuesta: Record<string, unknown> }[]
): Promise<string[]> {
  if (imagenes.length === 0) return [];
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicacionesIaImagenes)
      .values(imagenes.map((i) => ({ empresaId, trabajoId, tipo: i.tipo, orden: i.orden, cuentaMlId: i.cuentaMlId ?? null, propuesta: i.propuesta, estado: "propuesta" })))
      .returning({ id: publicacionesIaImagenes.id })
  );
  return filas.map((f) => f.id);
}

export type ImagenGuardada = {
  id: string;
  trabajoId: string;
  tipo: string;
  orden: number;
  cuentaMlId: string | null;
  estado: EstadoImagenIA;
  propuesta: Record<string, unknown> | null;
  url: string | null;
};

export async function leerImagenIA(empresaId: string, imagenId: string): Promise<ImagenGuardada | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: publicacionesIaImagenes.id,
        trabajoId: publicacionesIaImagenes.trabajoId,
        tipo: publicacionesIaImagenes.tipo,
        orden: publicacionesIaImagenes.orden,
        cuentaMlId: publicacionesIaImagenes.cuentaMlId,
        estado: publicacionesIaImagenes.estado,
        propuesta: publicacionesIaImagenes.propuesta,
        url: publicacionesIaImagenes.urlCloudinary,
      })
      .from(publicacionesIaImagenes)
      .where(and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.id, imagenId)))
  );
  return fila ? { ...fila, estado: fila.estado as EstadoImagenIA, propuesta: (fila.propuesta as Record<string, unknown> | null) ?? null } : null;
}

export async function leerTrabajoIA(empresaId: string, trabajoId: string): Promise<{ id: string; siteId: string; estilo: string; ficha: unknown; cuentaMlId: string | null } | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: publicacionesIaTrabajos.id, siteId: publicacionesIaTrabajos.siteId, estilo: publicacionesIaTrabajos.estilo, ficha: publicacionesIaTrabajos.ficha, cuentaMlId: publicacionesIaTrabajos.cuentaMlId })
      .from(publicacionesIaTrabajos)
      .where(and(eq(publicacionesIaTrabajos.empresaId, empresaId), eq(publicacionesIaTrabajos.id, trabajoId)))
  );
  return fila ?? null;
}

export async function actualizarPropuestaIA(empresaId: string, imagenId: string, propuesta: Record<string, unknown>): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(publicacionesIaImagenes)
      .set({ propuesta, estado: "propuesta" })
      .where(and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.id, imagenId)))
  );
}

export type ResultadoCupo = "tomado" | "en_cola" | "en_curso" | "no_existe";

// Intenta pasar la imagen a «generando». Con candado por empresa
// (pg_advisory_xact_lock) para que dos pedidos al mismo tiempo nunca
// pasen el máximo. Sin cupo, la imagen queda «aprobada» (en cola).
export async function tomarCupoImagen(empresaId: string, imagenId: string, ahora = new Date(), maximo = MAXIMO_GENERANDO_POR_EMPRESA): Promise<ResultadoCupo> {
  return dbComoEmpresa(empresaId, async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`publicaciones_ia:${empresaId}`}))`);
    const limite = new Date(ahora.getTime() - MINUTOS_GENERANDO_ATASCADA * 60_000);
    await tx
      .update(publicacionesIaImagenes)
      .set({ estado: "error" })
      .where(and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.estado, "generando"), lt(publicacionesIaImagenes.inicioGeneracionTs, limite)));
    const [imagen] = await tx
      .select({ estado: publicacionesIaImagenes.estado })
      .from(publicacionesIaImagenes)
      .where(and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.id, imagenId)));
    if (!imagen) return "no_existe";
    if (imagen.estado === "generando") return "en_curso";
    const [{ generando }] = await tx
      .select({ generando: sql<number>`count(*)`.mapWith(Number) })
      .from(publicacionesIaImagenes)
      .where(and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.estado, "generando")));
    const donde = and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.id, imagenId));
    if (generando >= maximo) {
      await tx.update(publicacionesIaImagenes).set({ estado: "aprobada" }).where(donde);
      return "en_cola";
    }
    await tx.update(publicacionesIaImagenes).set({ estado: "generando", inicioGeneracionTs: ahora }).where(donde);
    return "tomado";
  });
}

export async function terminarImagenIA(
  empresaId: string,
  imagenId: string,
  resultado: { url: string; diagnostico: Record<string, unknown> | null } | { error: true }
): Promise<void> {
  const cambios = "error" in resultado ? { estado: "error" } : { estado: "lista", urlCloudinary: resultado.url, diagnostico: resultado.diagnostico };
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(publicacionesIaImagenes)
      .set(cambios)
      .where(and(eq(publicacionesIaImagenes.empresaId, empresaId), eq(publicacionesIaImagenes.id, imagenId)))
  );
}
