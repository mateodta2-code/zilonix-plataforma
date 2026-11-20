// Optimización — bitácora de cambios de una publicación. Sale de la
// auditoría que ya guarda cada cambio hecho desde Optimización (precio,
// título, fotos, pausar/activar: quién, cuándo, antes y después). Para
// cada cambio se compara la semana anterior con la semana desde el
// cambio (visitas, ventas, conversión, utilidad) cuando ya pasaron 7 días.
// Los cambios hechos directo en Mercado Libre no quedan aquí (las notas a
// mano llegan con la migración de la bitácora).

import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { auditoria, usuarios } from "@/db/schema";
import { hoyBogota } from "@/lib/publicidad/plan";
import { ACCIONES_BITACORA, DIAS_AVISO_REVISION, DIAS_MEDICION } from "./bitacoraResultado";

export { ACCIONES_BITACORA, DIAS_AVISO_REVISION, DIAS_MEDICION };

const ACCIONES = Object.keys(ACCIONES_BITACORA);

export type CambioBitacora = {
  id: string;
  accion: string;
  rotulo: string;
  ts: Date;
  dia: string; // YYYY-MM-DD de Bogotá
  usuario: string | null;
  valorAnterior: string | null;
  valorNuevo: string | null;
  detalle: string | null;
};

export async function leerCambiosPublicacion(empresaId: string, itemId: string, limite = 50): Promise<CambioBitacora[]> {
  const filas = await dbComoEmpresa(empresaId, (tx) =>
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
      .limit(limite)
  );
  return filas.map((f) => ({ ...f, rotulo: ACCIONES_BITACORA[f.accion] ?? f.accion, dia: hoyBogota(f.ts) }));
}

// Publicaciones de la lista con algún cambio que ya cumplió 7 días (y no
// más de 14): son las que toca revisar esta semana.
export async function publicacionesParaRevisar(empresaId: string, itemIds: string[], ahora: Date): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const desde = new Date(ahora.getTime() - DIAS_AVISO_REVISION * 86_400_000);
  const hasta = new Date(ahora.getTime() - DIAS_MEDICION * 86_400_000);
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .selectDistinct({ itemId: auditoria.entidadId })
      .from(auditoria)
      .where(
        and(
          eq(auditoria.empresaId, empresaId),
          eq(auditoria.entidad, "publicacion_ml"),
          inArray(auditoria.entidadId, itemIds),
          inArray(auditoria.accion, ACCIONES),
          gte(auditoria.ts, desde),
          lt(auditoria.ts, hasta)
        )
      )
  );
  return filas.map((f) => f.itemId).filter((id): id is string => id !== null);
}

