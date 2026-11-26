import { asc, eq } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas3pl, bodegas3plEmpresas, empresas } from "@/db/schema";

export type EstadoVinculoBodega = "activa" | "pausada";

// Issue #625 — empresas que atiende una bodega 3PL. Solo id, nombre y
// estado del vínculo: la política de empresas deja ver la fila completa
// a la bodega, así que esta consulta es quien limita a lo que corresponde
// (nunca NIT, plan ni nada más de la empresa).
export async function listarEmpresasQueAtiende(bodegaId: string): Promise<{ empresaId: string; nombre: string; estado: EstadoVinculoBodega }[]> {
  return dbComoBodega(bodegaId, (tx) =>
    tx
      .select({ empresaId: empresas.id, nombre: empresas.nombre, estado: bodegas3plEmpresas.estado })
      .from(bodegas3plEmpresas)
      .innerJoin(empresas, eq(empresas.id, bodegas3plEmpresas.empresaId))
      .where(eq(bodegas3plEmpresas.bodegaId, bodegaId))
      .orderBy(asc(empresas.nombre))
  );
}

// Lo que ve el vendedor: la bodega logística que lo atiende (solo nombre
// y estado del vínculo), o nada si no tiene ninguna ligada.
export async function listarBodegasQueAtiendenEmpresa(empresaId: string): Promise<{ bodegaId: string; nombre: string; estado: EstadoVinculoBodega }[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ bodegaId: bodegas3pl.id, nombre: bodegas3pl.nombre, estado: bodegas3plEmpresas.estado })
      .from(bodegas3plEmpresas)
      .innerJoin(bodegas3pl, eq(bodegas3pl.id, bodegas3plEmpresas.bodegaId))
      .where(eq(bodegas3plEmpresas.empresaId, empresaId))
      .orderBy(asc(bodegas3pl.nombre))
  );
}
