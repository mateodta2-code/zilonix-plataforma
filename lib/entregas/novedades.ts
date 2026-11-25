import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { entregasDomiciliario, entregasNovedades } from "@/db/schema";
import { registrarAuditoriaBodega } from "@/lib/bodega/auditoria";
import { EntregaInvalidaError } from "./entregas";
import { TIPOS_NOVEDAD, validarNovedad, type TipoNovedad } from "./tiposNovedad";

// Domi-4 — novedades de una entrega SIN cerrarla. Solo se agregan (la base
// no deja editarlas ni borrarlas). Quién crea y quién ve lo decide RLS
// (db/rls-setup.sql); acá se valida antes para dar un mensaje claro.

// Desde /domiciliario (accesoBodega("domiciliario")). novedadId llega ya
// generado: la acción lo usa para nombrar la foto antes de guardar.
export async function reportarNovedad(
  bodegaId: string,
  usuarioId: string,
  entrada: { novedadId: string; entregaId: string; tipo: string; detalle: string; fotoPublicId?: string }
): Promise<void> {
  const v = validarNovedad(entrada.tipo, entrada.detalle);
  if (!v.ok) throw new EntregaInvalidaError(v.error);
  await dbComoBodega(
    bodegaId,
    async (tx) => {
      const [propia] = await tx.select({ estado: entregasDomiciliario.estado, empresaId: entregasDomiciliario.empresaId }).from(entregasDomiciliario).where(eq(entregasDomiciliario.id, entrada.entregaId));
      if (!propia || (propia.estado !== "asignada" && propia.estado !== "en_camino")) throw new EntregaInvalidaError("Esa entrega no está disponible.");
      await tx.insert(entregasNovedades).values({
        id: entrada.novedadId,
        entregaId: entrada.entregaId,
        empresaId: propia.empresaId,
        bodegaId,
        usuarioId,
        tipo: v.tipo,
        detalle: v.detalle,
        fotoPublicId: entrada.fotoPublicId ?? null,
      });
      // Rastro para el vendedor, sin datos del comprador.
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        empresaId: propia.empresaId,
        usuarioId,
        accion: "entrega_novedad",
        entidad: "entrega_domiciliario",
        entidadId: entrada.entregaId,
        detalle: `Novedad: ${TIPOS_NOVEDAD[v.tipo]}${v.detalle ? ` — ${v.detalle}` : ""}`,
      });
    },
    "domiciliario",
    usuarioId
  );
}

export type NovedadEntrega = { id: string; entregaId: string; tipo: TipoNovedad; detalle: string | null; tieneFoto: boolean; creadaTs: Date };

const columnas = {
  id: entregasNovedades.id,
  entregaId: entregasNovedades.entregaId,
  tipo: entregasNovedades.tipo,
  detalle: entregasNovedades.detalle,
  tieneFoto: sql<boolean>`${entregasNovedades.fotoPublicId} is not null`,
  creadaTs: entregasNovedades.creadaTs,
};

// Para el VENDEDOR (Despachos): las de sus entregas, la más vieja primero.
export async function listarNovedadesDeEntregas(empresaId: string, entregaIds: string[]): Promise<NovedadEntrega[]> {
  if (entregaIds.length === 0) return [];
  return dbComoEmpresa(empresaId, (tx) =>
    tx.select(columnas).from(entregasNovedades).where(and(eq(entregasNovedades.empresaId, empresaId), inArray(entregasNovedades.entregaId, entregaIds))).orderBy(asc(entregasNovedades.creadaTs))
  );
}

// Para el DOMICILIARIO: las de sus entregas abiertas (RLS no le devuelve
// las de entregas cerradas ni las de otros).
export async function listarMisNovedades(bodegaId: string, usuarioId: string): Promise<NovedadEntrega[]> {
  return dbComoBodega(bodegaId, (tx) => tx.select(columnas).from(entregasNovedades).orderBy(asc(entregasNovedades.creadaTs)), "domiciliario", usuarioId);
}

// La foto de una novedad para el VENDEDOR. null si no existe, es de otra
// empresa o no tiene foto.
export async function fotoDeNovedad(empresaId: string, novedadId: string): Promise<string | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ fotoPublicId: entregasNovedades.fotoPublicId }).from(entregasNovedades).where(and(eq(entregasNovedades.id, novedadId), eq(entregasNovedades.empresaId, empresaId)))
  );
  return fila?.fotoPublicId ?? null;
}
