import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, cuentasFalabella, cuentasMl, devolucionesInventario, pedidoItems, pedidos, skus } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { patronBusquedaLike } from "@/lib/filtros-listado";
import { esUuid, validarCantidad } from "@/lib/inventario/calculos";
import { aplicarMovimientosTx, SkuNoValidoParaStockError } from "@/lib/inventario/movimientos";
import { filasDeDevolucionMl, type LineaVentaGuardada } from "@/lib/inventario/devoluciones-reglas";

// Productos → Devoluciones (28-nov). Lo que pidió el usuario: fecha, SKU,
// nombre, cantidad, estado (averiado o bueno), tienda, y que las de
// Mercado Libre «avisen que están por llegar» solas. Las de ML se traen con
// la misma lectura de Posventa → Devoluciones (lib/ml/devoluciones.ts: solo
// GET documentados) y el SKU sale de NUESTRAS ventas guardadas (pedidos y
// pedido_items), sin más llamadas a ML. Al recibir: «bueno» suma al stock
// de la bodega elegida; «averiado», a la bodega «Averiados», que no suma a
// lo publicado en ML. Nada del comprador se guarda.

export class DevolucionInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DevolucionInvalidaError";
  }
}

export const NOMBRE_BODEGA_AVERIADOS = "Averiados";
export type CondicionDevolucion = "bueno" | "averiado";

// Piezas puras en devoluciones-reglas.ts (se prueban sin base).
export { devolucionPorLlegar, diaBogotaDe, filasDeDevolucionMl, type LineaVentaGuardada } from "@/lib/inventario/devoluciones-reglas";

// ---------- Base de datos ----------

// La bodega «Averiados» de la empresa: se crea la primera vez, sin sumar a
// lo publicado en ML. Si ya existe (aunque la hayan renombrado no), se usa.
async function bodegaAveriadosTx(tx: typeof db, empresaId: string, usuarioId: string): Promise<string> {
  const [existente] = await tx
    .select({ id: bodegas.id, activa: bodegas.activa })
    .from(bodegas)
    .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.nombre, NOMBRE_BODEGA_AVERIADOS)));
  if (existente) {
    if (!existente.activa) throw new DevolucionInvalidaError(`La bodega «${NOMBRE_BODEGA_AVERIADOS}» está desactivada: actívala en Inventario → Bodegas.`);
    return existente.id;
  }
  const [nueva] = await tx
    .insert(bodegas)
    .values({ empresaId, nombre: NOMBRE_BODEGA_AVERIADOS, tipo: "propia", esPrincipal: false, sumaAlPublicado: false })
    .returning({ id: bodegas.id });
  await registrarAuditoria(tx, {
    empresaId,
    usuarioId,
    actorTipo: "persona",
    accion: "inventario.bodega_creada",
    entidad: "bodegas",
    entidadId: nueva.id,
    detalle: `Creó la bodega «${NOMBRE_BODEGA_AVERIADOS}» (no suma a lo publicado) al recibir una devolución averiada.`,
  });
  return nueva.id;
}

export type TiendaDevolucion = { cuentaMlId: string } | { cuentaFalabellaId: string } | { otra: string };

// Devolución registrada a mano (Falabella u otra tienda, o una de ML que no
// llegó sola). Queda «por llegar».
export async function registrarDevolucion(
  empresaId: string,
  usuarioId: string,
  datos: { fecha: string; tienda: TiendaDevolucion; skuId: string; cantidad: number; pedidoIdExterno: string | null; nota: string | null }
): Promise<{ id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datos.fecha)) throw new DevolucionInvalidaError("Elige la fecha de la devolución.");
  if (!esUuid(datos.skuId)) throw new SkuNoValidoParaStockError("Elige el SKU que vuelve.");
  validarCantidad("entrada", datos.cantidad);
  const otra = "otra" in datos.tienda ? datos.tienda.otra.trim().replace(/\s+/g, " ") : null;
  if (otra !== null && (otra.length < 1 || otra.length > 60)) throw new DevolucionInvalidaError("Escribe la tienda (hasta 60 caracteres).");
  const cuentaMlId = "cuentaMlId" in datos.tienda ? datos.tienda.cuentaMlId : null;
  const cuentaFalabellaId = "cuentaFalabellaId" in datos.tienda ? datos.tienda.cuentaFalabellaId : null;
  if ((cuentaMlId && !esUuid(cuentaMlId)) || (cuentaFalabellaId && !esUuid(cuentaFalabellaId))) throw new DevolucionInvalidaError("Esa tienda no es de esta empresa.");
  const pedido = (datos.pedidoIdExterno ?? "").trim().slice(0, 80) || null;
  const nota = (datos.nota ?? "").trim().slice(0, 200) || null;

  return dbComoEmpresa(empresaId, async (tx) => {
    const [sku] = await tx.select({ nombre: skus.nombre, esKit: skus.esKit }).from(skus).where(and(eq(skus.empresaId, empresaId), eq(skus.id, datos.skuId)));
    if (!sku) throw new SkuNoValidoParaStockError("Ese SKU no existe en esta empresa.");
    if (sku.esKit) throw new SkuNoValidoParaStockError("Un kit no vuelve al stock: registra sus componentes.");
    const [fila] = await tx
      .insert(devolucionesInventario)
      .values({ empresaId, fecha: datos.fecha, cuentaMlId, cuentaFalabellaId, tiendaOtra: otra, pedidoIdExterno: pedido, skuId: datos.skuId, producto: sku.nombre, cantidad: datos.cantidad, nota, creadoPor: usuarioId })
      .returning({ id: devolucionesInventario.id });
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.devolucion_registrada",
      entidad: "devoluciones_inventario",
      entidadId: fila.id,
      detalle: `Devolución por llegar: ${datos.cantidad} × ${sku.nombre}.`,
    });
    return fila;
  });
}

// Guarda las devoluciones de ML «por llegar»: crea las nuevas y refresca
// el estado del envío de las que siguen por llegar. Idempotente: la clave
// única (empresa, reclamo, línea) no deja traer dos veces la misma.
export async function guardarDevolucionesMl(
  empresaId: string,
  usuarioId: string,
  devoluciones: { reclamoId: string; ordenId: string | null; fecha: string; estadoEnvio: string | null; cuentaMlId: string }[]
): Promise<{ nuevas: number; actualizadas: number; sinVenta: number }> {
  if (devoluciones.length === 0) return { nuevas: 0, actualizadas: 0, sinVenta: 0 };
  return dbComoEmpresa(empresaId, async (tx) => {
    const ordenes = [...new Set(devoluciones.map((d) => d.ordenId).filter((o): o is string => !!o))];
    const lineas =
      ordenes.length === 0
        ? []
        : await tx
            .select({ orden: pedidos.pedidoIdExterno, linea: pedidoItems.linea, skuId: pedidoItems.skuId, titulo: pedidoItems.titulo, cantidad: pedidoItems.cantidad })
            .from(pedidoItems)
            .innerJoin(pedidos, and(eq(pedidos.empresaId, pedidoItems.empresaId), eq(pedidos.id, pedidoItems.pedidoId)))
            .where(and(eq(pedidos.empresaId, empresaId), inArray(pedidos.pedidoIdExterno, ordenes)));
    const porOrden = new Map<string, LineaVentaGuardada[]>();
    for (const l of lineas) porOrden.set(l.orden, [...(porOrden.get(l.orden) ?? []), { linea: l.linea, skuId: l.skuId, titulo: l.titulo, cantidad: l.cantidad }]);

    let nuevas = 0;
    let actualizadas = 0;
    let sinVenta = 0;
    for (const d of devoluciones) {
      const filas = filasDeDevolucionMl(d, d.ordenId ? (porOrden.get(d.ordenId) ?? []) : []);
      if (filas.length === 1 && filas[0].skuId === null && !(d.ordenId && porOrden.has(d.ordenId))) sinVenta++;
      for (const f of filas) {
        const insertadas = await tx
          .insert(devolucionesInventario)
          .values({ empresaId, ...f, creadoPor: usuarioId })
          .onConflictDoNothing()
          .returning({ id: devolucionesInventario.id });
        if (insertadas.length > 0) {
          nuevas++;
          continue;
        }
        const refrescadas = await tx
          .update(devolucionesInventario)
          .set({ estadoEnvioMl: f.estadoEnvioMl })
          .where(
            and(
              eq(devolucionesInventario.empresaId, empresaId),
              eq(devolucionesInventario.reclamoIdMl, f.reclamoIdMl),
              eq(devolucionesInventario.lineaPedido, f.lineaPedido),
              eq(devolucionesInventario.estado, "por_llegar"),
              sql`${devolucionesInventario.estadoEnvioMl} is distinct from ${f.estadoEnvioMl}`
            )
          )
          .returning({ id: devolucionesInventario.id });
        actualizadas += refrescadas.length;
      }
    }
    if (nuevas > 0) {
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "inventario.devoluciones_ml_traidas",
        entidad: "devoluciones_inventario",
        detalle: `Trajo ${nuevas} devolución(es) de Mercado Libre por llegar.`,
      });
    }
    return { nuevas, actualizadas, sinVenta };
  });
}

// Recibir: «bueno» entra a la bodega elegida; «averiado», a «Averiados».
// El SKU se puede elegir aquí si la venta no lo tenía. Una sola vez: la
// clave del kardex es «devolucion:<id>» y la fila tiene que estar por llegar.
export async function recibirDevolucion(
  empresaId: string,
  usuarioId: string,
  id: string,
  datos: { condicion: CondicionDevolucion; bodegaId: string | null; skuId: string | null; cantidad: number }
): Promise<void> {
  if (!esUuid(id)) throw new DevolucionInvalidaError("Esa devolución no existe en esta empresa.");
  if (datos.condicion !== "bueno" && datos.condicion !== "averiado") throw new DevolucionInvalidaError("Elige si llegó en buen estado o averiada.");
  if (datos.condicion === "bueno" && !(datos.bodegaId && esUuid(datos.bodegaId))) throw new DevolucionInvalidaError("Elige la bodega donde entra.");
  if (datos.skuId !== null && !esUuid(datos.skuId)) throw new SkuNoValidoParaStockError("Elige el SKU que volvió.");
  validarCantidad("entrada", datos.cantidad);

  await dbComoEmpresa(empresaId, async (tx) => {
    const [dev] = await tx
      .select({ estado: devolucionesInventario.estado, skuId: devolucionesInventario.skuId, pedido: devolucionesInventario.pedidoIdExterno })
      .from(devolucionesInventario)
      .where(and(eq(devolucionesInventario.empresaId, empresaId), eq(devolucionesInventario.id, id)))
      .for("update");
    if (!dev) throw new DevolucionInvalidaError("Esa devolución no existe en esta empresa.");
    if (dev.estado !== "por_llegar") throw new DevolucionInvalidaError("Esa devolución ya se recibió o se anuló.");
    const skuId = datos.skuId ?? dev.skuId;
    if (!skuId) throw new SkuNoValidoParaStockError("Esta venta no tenía SKU: elige cuál volvió.");
    const [sku] = await tx.select({ nombre: skus.nombre, esKit: skus.esKit }).from(skus).where(and(eq(skus.empresaId, empresaId), eq(skus.id, skuId)));
    if (!sku) throw new SkuNoValidoParaStockError("Ese SKU no existe en esta empresa.");
    if (sku.esKit) throw new SkuNoValidoParaStockError("Un kit no vuelve al stock: registra sus componentes.");

    const bodegaId = datos.condicion === "averiado" ? await bodegaAveriadosTx(tx, empresaId, usuarioId) : (datos.bodegaId as string);
    // aplicarMovimientosTx valida que la bodega exista, sea de la empresa y esté activa.
    await aplicarMovimientosTx(tx, empresaId, {
      claveIdempotencia: `devolucion:${id}`,
      origen: "devolucion",
      referenciaId: id,
      actor: { tipo: "persona", usuarioId },
      nota: `Devolución ${datos.condicion === "bueno" ? "en buen estado" : "averiada"}${dev.pedido ? ` · orden ${dev.pedido}` : ""}`,
      lineas: [{ tipo: "entrada", bodegaId, skuId, cantidad: datos.cantidad }],
    });
    await tx
      .update(devolucionesInventario)
      .set({ estado: "recibida", condicion: datos.condicion, bodegaId, skuId, producto: sku.nombre, cantidad: datos.cantidad, recibidaTs: new Date(), recibidaPor: usuarioId })
      .where(and(eq(devolucionesInventario.empresaId, empresaId), eq(devolucionesInventario.id, id)));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.devolucion_recibida",
      entidad: "devoluciones_inventario",
      entidadId: id,
      detalle: `Recibió ${datos.cantidad} × ${sku.nombre} ${datos.condicion === "bueno" ? "en buen estado" : "averiado"}.`,
    });
  });
}

// Anular: solo lo que sigue por llegar (lo recibido ya está en el kardex).
export async function anularDevolucion(empresaId: string, usuarioId: string, id: string): Promise<void> {
  if (!esUuid(id)) throw new DevolucionInvalidaError("Esa devolución no existe en esta empresa.");
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .update(devolucionesInventario)
      .set({ estado: "anulada" })
      .where(and(eq(devolucionesInventario.empresaId, empresaId), eq(devolucionesInventario.id, id), eq(devolucionesInventario.estado, "por_llegar")))
      .returning({ id: devolucionesInventario.id });
    if (filas.length === 0) throw new DevolucionInvalidaError("Solo se anula una devolución que sigue por llegar.");
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.devolucion_anulada",
      entidad: "devoluciones_inventario",
      entidadId: id,
    });
  });
}

export type FilaDevolucionInventario = {
  id: string;
  fecha: string;
  skuId: string | null;
  skuCodigo: string | null;
  producto: string;
  cantidad: number;
  estado: "por_llegar" | "recibida" | "anulada";
  condicion: CondicionDevolucion | null;
  tienda: string | null;
  pedidoIdExterno: string | null;
  estadoEnvioMl: string | null;
  bodega: string | null;
};

// Las por llegar primero, luego por fecha. Buscador por SKU, producto,
// orden o tienda: un patrón ILIKE escapado, nunca texto del usuario en SQL.
export async function listarDevoluciones(empresaId: string, buscar?: string | null): Promise<FilaDevolucionInventario[]> {
  const patron = patronBusquedaLike(buscar ?? null);
  const tienda = sql<string | null>`coalesce(${cuentasMl.nickname}, ${cuentasFalabella.nickname}, ${devolucionesInventario.tiendaOtra})`;
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: devolucionesInventario.id,
        fecha: devolucionesInventario.fecha,
        skuId: devolucionesInventario.skuId,
        skuCodigo: skus.codigo,
        producto: devolucionesInventario.producto,
        cantidad: devolucionesInventario.cantidad,
        estado: devolucionesInventario.estado,
        condicion: devolucionesInventario.condicion,
        tienda,
        pedidoIdExterno: devolucionesInventario.pedidoIdExterno,
        estadoEnvioMl: devolucionesInventario.estadoEnvioMl,
        bodega: bodegas.nombre,
      })
      .from(devolucionesInventario)
      .leftJoin(skus, and(eq(skus.empresaId, devolucionesInventario.empresaId), eq(skus.id, devolucionesInventario.skuId)))
      .leftJoin(bodegas, and(eq(bodegas.empresaId, devolucionesInventario.empresaId), eq(bodegas.id, devolucionesInventario.bodegaId)))
      .leftJoin(cuentasMl, and(eq(cuentasMl.empresaId, devolucionesInventario.empresaId), eq(cuentasMl.id, devolucionesInventario.cuentaMlId)))
      .leftJoin(cuentasFalabella, and(eq(cuentasFalabella.empresaId, devolucionesInventario.empresaId), eq(cuentasFalabella.id, devolucionesInventario.cuentaFalabellaId)))
      .where(
        and(
          eq(devolucionesInventario.empresaId, empresaId),
          patron === null
            ? undefined
            : or(
                sql`${skus.codigo} ilike ${patron}`,
                sql`${devolucionesInventario.producto} ilike ${patron}`,
                sql`${devolucionesInventario.pedidoIdExterno} ilike ${patron}`,
                sql`${tienda} ilike ${patron}`
              )
        )
      )
      .orderBy(sql`(${devolucionesInventario.estado} = 'por_llegar') desc`, desc(devolucionesInventario.fecha), desc(devolucionesInventario.creadoTs))
      .limit(500)
  );
}

// Tiendas para el formulario: las cuentas de ML y de Falabella de la
// empresa (solo id y apodo) y «Otra» escrita a mano.
export async function listarTiendasDevolucion(empresaId: string): Promise<{ valor: string; nombre: string }[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const ml = await tx.select({ id: cuentasMl.id, nombre: cuentasMl.nickname }).from(cuentasMl).where(eq(cuentasMl.empresaId, empresaId));
    const fal = await tx.select({ id: cuentasFalabella.id, nombre: cuentasFalabella.nickname }).from(cuentasFalabella).where(eq(cuentasFalabella.empresaId, empresaId));
    return [...ml.map((c) => ({ valor: `ml:${c.id}`, nombre: `${c.nombre} (Mercado Libre)` })), ...fal.map((c) => ({ valor: `falabella:${c.id}`, nombre: `${c.nombre} (Falabella)` }))];
  });
}
