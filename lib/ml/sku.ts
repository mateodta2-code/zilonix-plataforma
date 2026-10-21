import { randomUUID } from "crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { kitComponentes, publicaciones, skus } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";

export class SkuCodigoDuplicadoError extends Error {
  constructor(codigo: string) {
    super(`Ya existe un SKU con el código "${codigo}" en esta empresa.`);
    this.name = "SkuCodigoDuplicadoError";
  }
}

// Tarea 2.6 — "variantes" se resuelven como SKUs propios agrupados
// por nombreBase (ver comentario en db/schema.ts), no con una tabla
// aparte — más simple, y cada variante queda con su propio código,
// stock e historial reales.
export async function crearSku(
  empresaId: string,
  usuarioId: string,
  datos: { codigo: string; nombre: string; nombreBase?: string }
): Promise<{ id: string }> {
  return dbComoEmpresa(empresaId, async (tx) => {
    try {
      const [fila] = await tx
        .insert(skus)
        .values({ empresaId, codigo: datos.codigo, nombre: datos.nombre, nombreBase: datos.nombreBase })
        .returning({ id: skus.id });
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "crear_sku",
        entidad: "sku",
        detalle: `Creó el SKU ${datos.codigo} (${datos.nombre}).`,
      });
      return fila;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "23505") {
        throw new SkuCodigoDuplicadoError(datos.codigo);
      }
      throw error;
    }
  });
}

export async function listarSkus(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(skus).where(eq(skus.empresaId, empresaId)).orderBy(asc(skus.codigo)));
}

// Tarea 2.6 — "pantalla publicaciones sin SKU" y el criterio de
// "listo" ("ninguna publicación queda sin SKU") leen de acá.
export async function listarPublicacionesSinSku(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: publicaciones.id, titulo: publicaciones.titulo, precio: publicaciones.precio, stock: publicaciones.stock })
      .from(publicaciones)
      .where(and(eq(publicaciones.empresaId, empresaId), isNull(publicaciones.skuId)))
  );
}

// Enlaza una publicación a un SKU ya existente de esta empresa (RLS
// garantiza que nunca se pueda enlazar un SKU de otra empresa, aunque
// alguien manipule el formulario). Reenlazar una publicación que ya
// tenía SKU queda registrado en auditoría — es el "historial de
// cambios" que pide la tarea, reusando el mecanismo ya construido en
// la tarea 1.9 en vez de una tabla aparte solo para esto.
export async function vincularPublicacionASku(empresaId: string, usuarioId: string, publicacionId: string, skuId: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const [sku] = await tx.select({ codigo: skus.codigo }).from(skus).where(eq(skus.id, skuId));
    if (!sku) throw new Error("Ese SKU no existe en esta empresa.");

    await tx.update(publicaciones).set({ skuId }).where(eq(publicaciones.id, publicacionId));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "vincular_sku",
      entidad: "publicacion",
      detalle: `Enlazó la publicación con el SKU ${sku.codigo}.`,
    });
  });
}

export class KitSeContieneASiMismoError extends Error {
  constructor() {
    super("Un kit no puede contener su propio SKU como componente.");
    this.name = "KitSeContieneASiMismoError";
  }
}

// Tarea 2.6 — "kits". Convierte un SKU existente en kit y le define
// sus componentes de una vez (reemplaza los que tuviera antes, si
// los tenía — más simple que ir agregando/quitando uno por uno).
export async function definirKit(
  empresaId: string,
  usuarioId: string,
  skuKitId: string,
  componentes: { skuComponenteId: string; cantidad: number }[]
): Promise<void> {
  if (componentes.some((c) => c.skuComponenteId === skuKitId)) {
    throw new KitSeContieneASiMismoError();
  }

  await dbComoEmpresa(empresaId, async (tx) => {
    await tx.update(skus).set({ esKit: true }).where(eq(skus.id, skuKitId));
    await tx.delete(kitComponentes).where(eq(kitComponentes.skuKitId, skuKitId));
    if (componentes.length > 0) {
      await tx.insert(kitComponentes).values(
        componentes.map((c) => ({ id: randomUUID(), empresaId, skuKitId, skuComponenteId: c.skuComponenteId, cantidad: c.cantidad }))
      );
    }
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "definir_kit",
      entidad: "sku",
      detalle: `Definió un kit con ${componentes.length} componente(s).`,
    });
  });
}
