import { and, asc, count, eq, ilike, isNotNull, isNull, notExists, or, sql, type SQL } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { costosSku, publicaciones, skus, terceros } from "@/db/schema";
import { packingEfectivo, type PackingEfectivo } from "@/lib/costos-sku";
import { acotarPagina, parsearPagina, patronBusquedaLike } from "@/lib/filtros-listado";
import { contarPublicacionesSinSku } from "@/lib/ml/sku";

// Issue #128 (Z-FIN-06) — lectura de la tabla maestra para la pantalla
// y las alertas. Los filtros salen de la URL: el proveedor solo se
// acepta si es un id de un tercero de ESTA empresa (lista blanca), la
// búsqueda pasa por patronBusquedaLike y la página por parsearPagina.
// Ningún texto del usuario se arma como SQL.

export const TAMANO_PAGINA_MAESTRA = 50;
// Valor especial del filtro de proveedor: SKU sin proveedor asignado.
export const FILTRO_SIN_PROVEEDOR = "sin";

export type FiltroMaestra = {
  proveedor?: string;
  busqueda?: string;
  soloSinCosto?: string;
  pagina?: string;
};

export type FilaMaestra = {
  id: string;
  skuCodigo: string;
  nombreProducto: string | null;
  costo: string | null;
  empaque: string | null;
  envioAgencia: string | null;
  precioMinimoUnidad: string | null;
  precioMinimoComboX2: string | null;
  precioMinimoComboX3: string | null;
  precioVenta: string | null;
  terceroId: string | null;
  proveedorNombre: string | null;
  fuente: "manual" | "archivo";
  actualizadoTs: Date;
  packing: PackingEfectivo;
};

export type ResultadoMaestra = {
  filas: FilaMaestra[];
  total: number;
  pagina: number;
  totalPaginas: number;
  // Lo que de verdad se aplicó (un proveedor ajeno o inventado queda en undefined).
  filtroAplicado: { proveedor?: string; busqueda?: string; soloSinCosto: boolean };
};

export async function listarMaestraFiltrada(empresaId: string, filtro: FiltroMaestra = {}): Promise<ResultadoMaestra> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const condiciones: SQL[] = [eq(costosSku.empresaId, empresaId)];

    let proveedor: string | undefined;
    if (filtro.proveedor === FILTRO_SIN_PROVEEDOR) {
      proveedor = FILTRO_SIN_PROVEEDOR;
      condiciones.push(isNull(costosSku.terceroId));
    } else if (filtro.proveedor) {
      const propios = await tx.select({ id: terceros.id }).from(terceros).where(eq(terceros.empresaId, empresaId));
      if (propios.some((t) => t.id === filtro.proveedor)) {
        proveedor = filtro.proveedor;
        condiciones.push(eq(costosSku.terceroId, filtro.proveedor));
      }
    }

    const patron = patronBusquedaLike(filtro.busqueda);
    if (patron) condiciones.push(or(ilike(costosSku.skuCodigo, patron), ilike(costosSku.nombreProducto, patron))!);

    const soloSinCosto = filtro.soloSinCosto === "1";
    if (soloSinCosto) condiciones.push(isNull(costosSku.costo));

    const donde = and(...condiciones);
    const [{ total }] = await tx.select({ total: count() }).from(costosSku).where(donde);
    const totalPaginas = Math.ceil(total / TAMANO_PAGINA_MAESTRA);
    const pagina = acotarPagina(parsearPagina(filtro.pagina), totalPaginas);

    const filas = await tx
      .select({ fila: costosSku, proveedorNombre: terceros.nombre, empaqueProveedor: terceros.empaque })
      .from(costosSku)
      .leftJoin(terceros, and(eq(terceros.id, costosSku.terceroId), eq(terceros.empresaId, costosSku.empresaId)))
      .where(donde)
      .orderBy(asc(costosSku.skuCodigo))
      .limit(TAMANO_PAGINA_MAESTRA)
      .offset((pagina - 1) * TAMANO_PAGINA_MAESTRA);

    return {
      filas: filas.map(({ fila, proveedorNombre, empaqueProveedor }) => ({
        id: fila.id,
        skuCodigo: fila.skuCodigo,
        nombreProducto: fila.nombreProducto,
        costo: fila.costo,
        empaque: fila.empaque,
        envioAgencia: fila.envioAgencia,
        precioMinimoUnidad: fila.precioMinimoUnidad,
        precioMinimoComboX2: fila.precioMinimoComboX2,
        precioMinimoComboX3: fila.precioMinimoComboX3,
        precioVenta: fila.precioVenta,
        terceroId: fila.terceroId,
        proveedorNombre,
        fuente: fila.fuente,
        actualizadoTs: fila.actualizadoTs,
        packing: packingEfectivo(fila.empaque, empaqueProveedor),
      })),
      total,
      pagina,
      totalPaginas,
      filtroAplicado: { proveedor, busqueda: patron ? filtro.busqueda?.trim() : undefined, soloSinCosto },
    };
  });
}

const LIMITE_LISTA_ALERTA = 100;

export type AlertasMaestra = {
  // Costo vacío en la maestra. Un costo 0 puesto a propósito no entra.
  sinCosto: { total: number; skus: { skuCodigo: string; nombreProducto: string | null }[] };
  // SKU de publicaciones (vía publicaciones.sku_id → skus.codigo) que no
  // tienen fila en la maestra: sus ventas van a quedar sin costo.
  publicadosFueraDeMaestra: { total: number; skus: { skuCodigo: string; publicaciones: number }[] };
  publicacionesSinSku: number;
};

// No calcula ninguna utilidad. Las ventas afectadas (conteo y valor)
// necesitan las líneas de venta con SKU, que llegan con #129/#130.
export async function alertasMaestra(empresaId: string): Promise<AlertasMaestra> {
  const codigoNormalizado = sql<string>`upper(btrim(${skus.codigo}))`;

  const [sinCosto, publicados, publicacionesSinSku] = await Promise.all([
    dbComoEmpresa(empresaId, async (tx) => {
      const donde = and(eq(costosSku.empresaId, empresaId), isNull(costosSku.costo));
      const [{ total }] = await tx.select({ total: count() }).from(costosSku).where(donde);
      const lista = await tx
        .select({ skuCodigo: costosSku.skuCodigo, nombreProducto: costosSku.nombreProducto })
        .from(costosSku)
        .where(donde)
        .orderBy(asc(costosSku.skuCodigo))
        .limit(LIMITE_LISTA_ALERTA);
      return { total, skus: lista };
    }),
    dbComoEmpresa(empresaId, async (tx) => {
      const fuera = notExists(
        tx
          .select({ uno: sql`1` })
          .from(costosSku)
          .where(and(eq(costosSku.empresaId, empresaId), eq(costosSku.skuCodigo, codigoNormalizado)))
      );
      const filas = await tx
        .select({ skuCodigo: codigoNormalizado, publicaciones: count() })
        .from(publicaciones)
        .innerJoin(skus, and(eq(skus.id, publicaciones.skuId), eq(skus.empresaId, publicaciones.empresaId)))
        .where(and(eq(publicaciones.empresaId, empresaId), isNotNull(publicaciones.skuId), fuera))
        .groupBy(codigoNormalizado)
        .orderBy(codigoNormalizado);
      return { total: filas.length, skus: filas.slice(0, LIMITE_LISTA_ALERTA) };
    }),
    contarPublicacionesSinSku(empresaId),
  ]);

  return { sinCosto, publicadosFueraDeMaestra: publicados, publicacionesSinSku };
}

export async function listarProveedoresParaFiltro(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: terceros.id, nombre: terceros.nombre, activo: terceros.activo, empaque: terceros.empaque })
      .from(terceros)
      .where(eq(terceros.empresaId, empresaId))
      .orderBy(asc(terceros.nombre))
  );
}
