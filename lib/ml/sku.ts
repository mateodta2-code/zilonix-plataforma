import { randomUUID } from "crypto";
import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { kitComponentes, publicaciones, skus } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { acotarPagina, parsearPagina, patronBusquedaLike } from "@/lib/filtros-listado";

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

// Lista completa, sin paginar — la usa el <select> de "Elegir SKU…" en
// /panel/sku/sin-vincular (necesita TODO el catálogo para elegir, no
// una página de 25) y lib/panel-kpis.ts. listarSkusFiltrados() (abajo)
// es la versión con búsqueda/filtro/orden/paginación para la tabla de
// /panel/sku — nunca se reemplazó esta por esa, son dos usos distintos.
export async function listarSkus(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) => tx.select().from(skus).where(eq(skus.empresaId, empresaId)).orderBy(asc(skus.codigo)));
}

// Tarea 2.6 — "pantalla publicaciones sin SKU" y el criterio de
// "listo" ("ninguna publicación queda sin SKU") leen de acá. Lista
// completa, sin paginar — la usa el KPI del panel (lib/panel-kpis.ts)
// y el aviso de /panel/sku ("3 publicación(es) sin SKU todavía").
// listarPublicacionesSinSkuFiltradas() (abajo) es la versión paginada
// para la tabla de /panel/sku/sin-vincular.
export async function listarPublicacionesSinSku(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: publicaciones.id, titulo: publicaciones.titulo, precio: publicaciones.precio, stock: publicaciones.stock })
      .from(publicaciones)
      .where(and(eq(publicaciones.empresaId, empresaId), isNull(publicaciones.skuId)))
  );
}

// Issue "tabla completa de despachos" — count(*) con EXACTAMENTE el
// mismo WHERE que listarPublicacionesSinSku(), para el KPI del panel
// (lib/panel-kpis.ts): ese solo necesita el número, nunca las filas
// completas. lib/ml/sku.test.ts prueba que da el mismo resultado que
// listarPublicacionesSinSku(...).length con los mismos datos.
export async function contarPublicacionesSinSku(empresaId: string): Promise<number> {
  const [{ total }] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(publicaciones)
      .where(and(eq(publicaciones.empresaId, empresaId), isNull(publicaciones.skuId)))
  );
  return total;
}

// Issue "tabla completa de SKU" — mismo criterio de lib/filtros-listado.ts
// que ya usan Pedidos/Despachos (búsqueda recortada y con % _ \
// escapados, página entera segura y acotada al total real). Búsqueda
// por código O nombre — los dos únicos campos de texto libre real en
// skus (nunca se inventa un campo que no existe). "Estado" acá es el
// único categórico real de la tabla: esKit (Kit/Simple), no un status
// de Mercado Libre — se expone con el mismo nombre de parámetro
// (?estado=) que las demás tablas por consistencia de URL.
export const TIPOS_SKU_FILTRO = [
  { valor: "kit", etiqueta: "Kit" },
  { valor: "simple", etiqueta: "Simple" },
] as const;

export const ORDENES_SKU_FILTRO = ["codigo_asc", "codigo_desc", "nombre_asc", "nombre_desc"] as const;
export type OrdenSkus = (typeof ORDENES_SKU_FILTRO)[number];

export type FiltroSkus = {
  busqueda?: string; // código o nombre
  estado?: string; // "kit" | "simple"
  orden?: string;
  pagina?: number | string;
};

export type ResultadoSkus = {
  skus: (typeof skus.$inferSelect)[];
  total: number;
  pagina: number;
  totalPaginas: number;
};

const TAMANO_PAGINA_SKU = 25;

export async function listarSkusFiltrados(empresaId: string, filtro: FiltroSkus = {}): Promise<ResultadoSkus> {
  const condiciones = [eq(skus.empresaId, empresaId)];

  const patron = patronBusquedaLike(filtro.busqueda);
  const condicionBusqueda = patron ? or(ilike(skus.codigo, patron), ilike(skus.nombre, patron)) : undefined;
  if (condicionBusqueda) condiciones.push(condicionBusqueda);

  if (filtro.estado === "kit") condiciones.push(eq(skus.esKit, true));
  if (filtro.estado === "simple") condiciones.push(eq(skus.esKit, false));

  const ordenValido: OrdenSkus =
    filtro.orden && (ORDENES_SKU_FILTRO as readonly string[]).includes(filtro.orden) ? (filtro.orden as OrdenSkus) : "codigo_asc";
  // Desempate por id en la MISMA dirección que la columna principal —
  // mismo criterio que lib/ml/pedidos.ts y lib/ml/despachos.ts.
  const descendente = ordenValido.endsWith("_desc");
  const ordenId = descendente ? desc(skus.id) : asc(skus.id);
  const columnaOrden = ordenValido.startsWith("nombre")
    ? descendente
      ? desc(skus.nombre)
      : asc(skus.nombre)
    : descendente
      ? desc(skus.codigo)
      : asc(skus.codigo);

  const paginaPedida = parsearPagina(filtro.pagina);

  return dbComoEmpresa(empresaId, async (tx) => {
    const condicion = and(...condiciones);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(skus)
      .where(condicion);
    const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_SKU));
    const pagina = acotarPagina(paginaPedida, totalPaginas);

    const filas = await tx
      .select()
      .from(skus)
      .where(condicion)
      .orderBy(columnaOrden, ordenId)
      .limit(TAMANO_PAGINA_SKU)
      .offset((pagina - 1) * TAMANO_PAGINA_SKU);

    return { skus: filas, total, pagina, totalPaginas };
  });
}

// Issue "tabla completa de SKU" — misma validación compartida, ahora
// sobre publicaciones sin SKU (el alcance de siempre: empresaId +
// skuId IS NULL, igual que listarPublicacionesSinSku). Búsqueda por
// título O por el id de publicación de Mercado Libre
// (publicacionIdExterno) — "comprador" no existe en esta tabla, igual
// que en pedidos. Sin filtro de "estado": no hay ningún campo
// categórico real en publicaciones aparte de skuId (que acá siempre es
// null por definición de la pantalla) — se documenta la ausencia en
// vez de inventar uno.
export const ORDENES_SIN_VINCULAR_FILTRO = ["importado_desc", "importado_asc", "titulo_asc", "titulo_desc"] as const;
export type OrdenSinVincular = (typeof ORDENES_SIN_VINCULAR_FILTRO)[number];

export type FiltroSinVincular = {
  busqueda?: string; // título o id de publicación de ML
  orden?: string;
  pagina?: number | string;
};

export type PublicacionSinSku = { id: string; titulo: string; precio: string; stock: number; publicacionIdExterno: string };

export type ResultadoSinVincular = {
  publicaciones: PublicacionSinSku[];
  total: number;
  pagina: number;
  totalPaginas: number;
};

const TAMANO_PAGINA_SIN_VINCULAR = 25;

export async function listarPublicacionesSinSkuFiltradas(empresaId: string, filtro: FiltroSinVincular = {}): Promise<ResultadoSinVincular> {
  const condiciones = [eq(publicaciones.empresaId, empresaId), isNull(publicaciones.skuId)];

  const patron = patronBusquedaLike(filtro.busqueda);
  const condicionBusqueda = patron ? or(ilike(publicaciones.titulo, patron), ilike(publicaciones.publicacionIdExterno, patron)) : undefined;
  if (condicionBusqueda) condiciones.push(condicionBusqueda);

  const ordenValido: OrdenSinVincular =
    filtro.orden && (ORDENES_SIN_VINCULAR_FILTRO as readonly string[]).includes(filtro.orden) ? (filtro.orden as OrdenSinVincular) : "importado_desc";
  const descendente = ordenValido.endsWith("_desc");
  const ordenId = descendente ? desc(publicaciones.id) : asc(publicaciones.id);
  const columnaOrden = ordenValido.startsWith("titulo")
    ? descendente
      ? desc(publicaciones.titulo)
      : asc(publicaciones.titulo)
    : descendente
      ? desc(publicaciones.importadoTs)
      : asc(publicaciones.importadoTs);

  const paginaPedida = parsearPagina(filtro.pagina);

  return dbComoEmpresa(empresaId, async (tx) => {
    const condicion = and(...condiciones);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(publicaciones)
      .where(condicion);
    const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_SIN_VINCULAR));
    const pagina = acotarPagina(paginaPedida, totalPaginas);

    const filas = await tx
      .select({
        id: publicaciones.id,
        titulo: publicaciones.titulo,
        precio: publicaciones.precio,
        stock: publicaciones.stock,
        publicacionIdExterno: publicaciones.publicacionIdExterno,
      })
      .from(publicaciones)
      .where(condicion)
      .orderBy(columnaOrden, ordenId)
      .limit(TAMANO_PAGINA_SIN_VINCULAR)
      .offset((pagina - 1) * TAMANO_PAGINA_SIN_VINCULAR);

    return { publicaciones: filas, total, pagina, totalPaginas };
  });
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
