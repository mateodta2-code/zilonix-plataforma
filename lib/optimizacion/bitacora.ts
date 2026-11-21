// Optimización — bitácora de cambios de una publicación:
// - los cambios hechos desde Optimización, de la auditoría (precio,
//   título, fotos, pausar/activar: quién, cuándo, antes y después);
// - las notas a mano para cambios hechos fuera de Zilonix
//   (optimizacion_notas, migración 0035);
// - la revisión de cada uno (optimizacion_revisiones): sirvió, no sirvió
//   o sin cambio, con un comentario. Desde la 0036 puede ser solo un
//   comentario (resultado null): ese cambio sigue «sin revisar».
// El resultado a los 7 días se calcula en bitacoraResultado.ts.

import { and, desc, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, optimizacionNotas, optimizacionRevisiones, usuarios } from "@/db/schema";
import { hoyBogota } from "@/lib/publicidad/plan";
import { ACCIONES_BITACORA, DIAS_AVISO_REVISION, DIAS_MEDICION, listoParaRevisar, type ResultadoRevision } from "./bitacoraResultado";

export { ACCIONES_BITACORA, DIAS_AVISO_REVISION, DIAS_MEDICION };

const ACCIONES = Object.keys(ACCIONES_BITACORA);

export type RevisionCambio = { resultado: ResultadoRevision | null; comentario: string | null; usuario: string | null; ts: Date };

export type CambioBitacora = {
  id: string;
  // "auditoria:<id>" o "nota:<id>": la llave de su revisión.
  ref: string;
  origen: "zilonix" | "nota";
  accion: string;
  rotulo: string;
  ts: Date;
  dia: string; // YYYY-MM-DD de Bogotá
  usuario: string | null;
  valorAnterior: string | null;
  valorNuevo: string | null;
  detalle: string | null;
  revision: RevisionCambio | null;
};

export async function leerCambiosPublicacion(empresaId: string, itemId: string, limite = 50): Promise<CambioBitacora[]> {
  const [desdeZilonix, notas, revisiones] = await dbComoEmpresa(empresaId, (tx) =>
    Promise.all([
      tx
        .select({
          id: auditoria.id,
          accion: auditoria.accion,
          ts: auditoria.ts,
          usuario: usuarios.nombre,
          valorAnterior: auditoria.valorAnterior,
          valorNuevo: auditoria.valorNuevo,
          detalle: auditoria.detalle,
        })
        .from(auditoria)
        .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
        .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.entidad, "publicacion_ml"), eq(auditoria.entidadId, itemId), inArray(auditoria.accion, ACCIONES)))
        .orderBy(desc(auditoria.ts))
        .limit(limite),
      tx
        .select({ id: optimizacionNotas.id, ts: optimizacionNotas.fechaCambio, texto: optimizacionNotas.texto, usuario: usuarios.nombre })
        .from(optimizacionNotas)
        .leftJoin(usuarios, eq(usuarios.id, optimizacionNotas.usuarioId))
        .where(and(eq(optimizacionNotas.empresaId, empresaId), eq(optimizacionNotas.itemId, itemId)))
        .orderBy(desc(optimizacionNotas.fechaCambio))
        .limit(limite),
      tx
        .select({
          ref: optimizacionRevisiones.cambioRef,
          resultado: optimizacionRevisiones.resultado,
          comentario: optimizacionRevisiones.comentario,
          usuario: usuarios.nombre,
          ts: optimizacionRevisiones.revisadoTs,
        })
        .from(optimizacionRevisiones)
        .leftJoin(usuarios, eq(usuarios.id, optimizacionRevisiones.usuarioId))
        .where(and(eq(optimizacionRevisiones.empresaId, empresaId), eq(optimizacionRevisiones.itemId, itemId))),
    ])
  );
  const porRef = new Map(revisiones.map((r) => [r.ref, { resultado: r.resultado as ResultadoRevision | null, comentario: r.comentario, usuario: r.usuario, ts: r.ts }]));
  const cambios: CambioBitacora[] = [
    ...desdeZilonix.map((f) => ({
      ...f,
      ref: `auditoria:${f.id}`,
      origen: "zilonix" as const,
      rotulo: ACCIONES_BITACORA[f.accion] ?? f.accion,
      dia: hoyBogota(f.ts),
      revision: porRef.get(`auditoria:${f.id}`) ?? null,
    })),
    ...notas.map((n) => ({
      id: n.id,
      ref: `nota:${n.id}`,
      origen: "nota" as const,
      accion: "nota",
      rotulo: "Nota",
      ts: n.ts,
      dia: hoyBogota(n.ts),
      usuario: n.usuario,
      valorAnterior: null,
      valorNuevo: null,
      detalle: n.texto,
      revision: porRef.get(`nota:${n.id}`) ?? null,
    })),
  ];
  return cambios.sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limite);
}

// Publicaciones de la lista con algún cambio (de Zilonix o anotado) que
// ya cumplió su semana de medición, todavía sin resultado (un comentario
// solo no cuenta como revisado) y de hace no más
// de 14 días. Cuenta en días de calendario de Bogotá, igual que el
// detalle, para que «Revisar cambio» y «Mejoró/Empeoró» coincidan.
export async function publicacionesParaRevisar(empresaId: string, itemIds: string[], ahora: Date): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const hoy = hoyBogota(ahora);
  // Un margen de 2 días para cubrir el corte de Bogotá; el filtro fino es por día.
  const desde = new Date(ahora.getTime() - (DIAS_AVISO_REVISION + 2) * 86_400_000);
  const [desdeZilonix, notas, revisadas] = await dbComoEmpresa(empresaId, (tx) =>
    Promise.all([
      tx
        .select({ id: auditoria.id, itemId: auditoria.entidadId, ts: auditoria.ts })
        .from(auditoria)
        .where(
          and(
            eq(auditoria.empresaId, empresaId),
            eq(auditoria.entidad, "publicacion_ml"),
            inArray(auditoria.entidadId, itemIds),
            inArray(auditoria.accion, ACCIONES),
            gte(auditoria.ts, desde)
          )
        ),
      tx
        .select({ id: optimizacionNotas.id, itemId: optimizacionNotas.itemId, ts: optimizacionNotas.fechaCambio })
        .from(optimizacionNotas)
        .where(and(eq(optimizacionNotas.empresaId, empresaId), inArray(optimizacionNotas.itemId, itemIds), gte(optimizacionNotas.fechaCambio, desde))),
      tx
        .select({ ref: optimizacionRevisiones.cambioRef })
        .from(optimizacionRevisiones)
        .where(and(eq(optimizacionRevisiones.empresaId, empresaId), inArray(optimizacionRevisiones.itemId, itemIds), isNotNull(optimizacionRevisiones.resultado))),
    ])
  );
  const yaRevisadas = new Set(revisadas.map((r) => r.ref));
  const pendientes = new Set<string>();
  const revisar = (ref: string, itemId: string | null, ts: Date) => {
    if (itemId && !yaRevisadas.has(ref) && listoParaRevisar(hoyBogota(ts), hoy)) pendientes.add(itemId);
  };
  for (const c of desdeZilonix) revisar(`auditoria:${c.id}`, c.itemId, c.ts);
  for (const n of notas) revisar(`nota:${n.id}`, n.itemId, n.ts);
  return [...pendientes];
}

// El cambio que se va a revisar existe y es de esta publicación (nunca se
// confía en la referencia que manda el navegador).
export async function cambioEsDeLaPublicacion(empresaId: string, ref: string, itemId: string): Promise<boolean> {
  const [tipo, id] = ref.split(":");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return false;
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tipo === "auditoria"
      ? tx
          .select({ id: auditoria.id })
          .from(auditoria)
          .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.id, id), eq(auditoria.entidad, "publicacion_ml"), eq(auditoria.entidadId, itemId)))
      : tipo === "nota"
        ? tx
            .select({ id: optimizacionNotas.id })
            .from(optimizacionNotas)
            .where(and(eq(optimizacionNotas.empresaId, empresaId), eq(optimizacionNotas.id, id), eq(optimizacionNotas.itemId, itemId)))
        : Promise.resolve([])
  );
  return filas.length > 0;
}

export async function crearNotaBitacora(
  empresaId: string,
  datos: { usuarioId: string; cuentaMlId: string; itemId: string; fechaCambio: Date; texto: string }
): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(optimizacionNotas)
      .values({ empresaId, ...datos })
      .returning({ id: optimizacionNotas.id })
  );
  return fila.id;
}

// Una revisión por cambio: si se vuelve a revisar, se actualiza.
// resultado null = solo comentario (la base exige al menos uno de los dos).
export async function guardarRevisionCambio(
  empresaId: string,
  datos: { usuarioId: string; ref: string; itemId: string; resultado: ResultadoRevision | null; comentario: string | null }
): Promise<void> {
  const ahora = new Date();
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(optimizacionRevisiones)
      .values({ empresaId, cambioRef: datos.ref, itemId: datos.itemId, resultado: datos.resultado, comentario: datos.comentario, usuarioId: datos.usuarioId, revisadoTs: ahora })
      .onConflictDoUpdate({
        target: [optimizacionRevisiones.empresaId, optimizacionRevisiones.cambioRef],
        set: { resultado: datos.resultado, comentario: datos.comentario, usuarioId: datos.usuarioId, revisadoTs: ahora },
      })
  );
}
