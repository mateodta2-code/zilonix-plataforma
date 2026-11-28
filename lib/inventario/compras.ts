import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, cuentasDisponible, ordenCompraItems, ordenesCompra, recepcionItems, recepciones, skus, terceros } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { esUuid, validarCantidad } from "@/lib/inventario/calculos";
import { aplicarMovimientosTx, SkuNoValidoParaStockError } from "@/lib/inventario/movimientos";
import { validarMonto } from "@/lib/finanzas/montos";
import { patronBusquedaLike } from "@/lib/filtros-listado";
import { SkuCodigoDuplicadoError } from "@/lib/ml/sku";
import { notaRecepcion, validarCodigoSku, validarDatosCompra, type DatosCompra } from "@/lib/inventario/registro-compras";

// Issue #280 — compras simples: una orden de compra (OC) con sus SKU y
// la recepción de lo que de verdad llegó, contra una OC o directa. La
// recepción es lo único que suma stock (entrada en el kardex); la OC
// sola no mueve nada.



export class CompraInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "CompraInvalidaError";
  }
}

type LineaOc = { skuId: string; cantidad: number; costoUnitario?: string | null };

function sinSkusRepetidos(lineas: { skuId: string }[]): void {
  if (new Set(lineas.map((l) => l.skuId)).size !== lineas.length) {
    throw new CompraInvalidaError("Un mismo SKU aparece dos veces: júntalo en una sola línea.");
  }
}

export async function crearOrdenCompra(
  empresaId: string,
  usuarioId: string,
  datos: { terceroId: string | null; bodegaDestinoId: string; nota: string | null; lineas: LineaOc[] }
): Promise<{ id: string; numero: number }> {
  if (datos.lineas.length === 0) throw new CompraInvalidaError("La orden necesita al menos un SKU.");
  if (!esUuid(datos.bodegaDestinoId)) throw new CompraInvalidaError("Elige la bodega de destino.");
  if (datos.terceroId !== null && !esUuid(datos.terceroId)) throw new CompraInvalidaError("Ese proveedor no existe en esta empresa.");
  if (!datos.lineas.every((l) => esUuid(l.skuId))) throw new SkuNoValidoParaStockError("Elige un SKU de la lista.");
  sinSkusRepetidos(datos.lineas);
  for (const l of datos.lineas) validarCantidad("entrada", l.cantidad);
  const lineas = datos.lineas.map((l) => ({ ...l, costoUnitario: validarMonto(l.costoUnitario, "Costo unitario") }));

  return dbComoEmpresa(empresaId, async (tx) => {
    await validarSkusSimplesTx(tx, empresaId, lineas.map((l) => l.skuId));
    return insertarOrdenTx(tx, empresaId, usuarioId, { ...datos, compra: null }, lineas);
  });
}

type LineaOcValida = { skuId: string; cantidad: number; costoUnitario: string | null };

// Bodega, proveedor, consecutivo, la OC y sus líneas, y la auditoría: lo
// comparten la OC de varios SKU (crearOrdenCompra) y el Registro de
// compras (registrarCompra, un producto por fila).
async function insertarOrdenTx(
  tx: typeof db,
  empresaId: string,
  usuarioId: string,
  datos: { terceroId: string | null; bodegaDestinoId: string; nota: string | null; compra: DatosCompra | null },
  lineas: LineaOcValida[]
): Promise<{ id: string; numero: number }> {
  const [bodega] = await tx
    .select({ id: bodegas.id, activa: bodegas.activa })
    .from(bodegas)
    .where(and(eq(bodegas.empresaId, empresaId), eq(bodegas.id, datos.bodegaDestinoId)));
  if (!bodega?.activa) throw new CompraInvalidaError("La bodega de destino no existe o está desactivada.");
  if (datos.terceroId) {
    const [t] = await tx.select({ id: terceros.id }).from(terceros).where(and(eq(terceros.empresaId, empresaId), eq(terceros.id, datos.terceroId)));
    if (!t) throw new CompraInvalidaError("Ese proveedor no existe en esta empresa.");
  }

  // Consecutivo por empresa. Dos OC creadas en el mismo instante
  // chocan con el único (empresa, número) y la segunda falla: se
  // bloquea la empresa un momento para que no pase.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`ordenes_compra:${empresaId}`}))`);
  const [{ siguiente }] = await tx
    .select({ siguiente: sql<number>`coalesce(max(${ordenesCompra.numero}), 0)::int + 1` })
    .from(ordenesCompra)
    .where(eq(ordenesCompra.empresaId, empresaId));
  const [orden] = await tx
    .insert(ordenesCompra)
    .values({
      empresaId,
      numero: Number(siguiente),
      terceroId: datos.terceroId,
      bodegaDestinoId: datos.bodegaDestinoId,
      nota: datos.nota,
      creadoPor: usuarioId,
      ...(datos.compra ?? {}),
    })
    .returning({ id: ordenesCompra.id, numero: ordenesCompra.numero });
  await tx.insert(ordenCompraItems).values(
    lineas.map((l) => ({ empresaId, ordenCompraId: orden.id, skuId: l.skuId, cantidadPedida: l.cantidad, costoUnitario: l.costoUnitario }))
  );
  await registrarAuditoria(tx, {
    empresaId,
    usuarioId,
    actorTipo: "persona",
    accion: "inventario.orden_compra_creada",
    entidad: "ordenes_compra",
    entidadId: orden.id,
    detalle: `OC-${orden.numero} con ${lineas.length} SKU.`,
  });
  return orden;
}

// Registro de compras (27-nov) — una fila = un producto comprado, como la
// hoja del Zilonix OS. Si el producto es nuevo, su SKU se crea en la
// MISMA transacción: si algo de la compra falla, no queda un SKU suelto.
export async function registrarCompra(
  empresaId: string,
  usuarioId: string,
  datos: {
    producto: { skuId: string } | { nuevo: { codigo: string; nombre: string } };
    cantidad: number;
    costoUnitario: string | null;
    bodegaDestinoId: string;
    terceroId: string | null;
    nota: string | null;
    compra: Partial<DatosCompra>;
  }
): Promise<{ id: string; numero: number }> {
  if (!esUuid(datos.bodegaDestinoId)) throw new CompraInvalidaError("Elige la bodega de destino.");
  if (datos.terceroId !== null && !esUuid(datos.terceroId)) throw new CompraInvalidaError("Ese proveedor no existe en esta empresa.");
  validarCantidad("entrada", datos.cantidad);
  const costoUnitario = validarMonto(datos.costoUnitario, "Valor unidad");
  const compra = validarDatosCompra(datos.compra);
  const nuevo =
    "nuevo" in datos.producto
      ? (() => {
          const nombre = datos.producto.nuevo.nombre.trim().replace(/\s+/g, " ");
          if (nombre.length < 2 || nombre.length > 200) throw new CompraInvalidaError("Escribe el nombre del producto (de 2 a 200 caracteres).");
          return { codigo: validarCodigoSku(datos.producto.nuevo.codigo), nombre };
        })()
      : null;
  if (!nuevo && !esUuid((datos.producto as { skuId: string }).skuId)) throw new SkuNoValidoParaStockError("Elige un SKU de la lista o crea el producto.");

  return dbComoEmpresa(empresaId, async (tx) => {
    let skuId: string;
    if (nuevo) {
      try {
        const [fila] = await tx.insert(skus).values({ empresaId, codigo: nuevo.codigo, nombre: nuevo.nombre }).returning({ id: skus.id });
        skuId = fila.id;
      } catch (error) {
        if (error && typeof error === "object" && "code" in error && error.code === "23505") throw new SkuCodigoDuplicadoError(nuevo.codigo);
        throw error;
      }
      await registrarAuditoria(tx, {
        empresaId,
        usuarioId,
        actorTipo: "persona",
        accion: "crear_sku",
        entidad: "sku",
        detalle: `Creó el SKU ${nuevo.codigo} (${nuevo.nombre}) desde el Registro de compras.`,
      });
    } else {
      skuId = (datos.producto as { skuId: string }).skuId;
      await validarSkusSimplesTx(tx, empresaId, [skuId]);
    }
    return insertarOrdenTx(
      tx,
      empresaId,
      usuarioId,
      { terceroId: datos.terceroId, bodegaDestinoId: datos.bodegaDestinoId, nota: datos.nota, compra },
      [{ skuId, cantidad: datos.cantidad, costoUnitario }]
    );
  });
}

// Corrige los datos de la compra en la plataforma (fecha, forma de pago,
// plataforma, orden, link, entrega estimada). Cantidades y costos no se
// tocan acá: la recepción y el kardex dependen de ellos.
export async function actualizarDatosCompra(empresaId: string, usuarioId: string, ordenId: string, entrada: Partial<DatosCompra>): Promise<void> {
  if (!esUuid(ordenId)) throw new CompraInvalidaError("Esa orden de compra no existe en esta empresa.");
  const compra = validarDatosCompra(entrada);
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .update(ordenesCompra)
      .set({ ...compra, actualizadoTs: new Date() })
      .where(and(eq(ordenesCompra.empresaId, empresaId), eq(ordenesCompra.id, ordenId)))
      .returning({ numero: ordenesCompra.numero });
    if (filas.length === 0) throw new CompraInvalidaError("Esa orden de compra no existe en esta empresa.");
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.orden_compra_editada",
      entidad: "ordenes_compra",
      entidadId: ordenId,
      detalle: `Actualizó los datos de compra de OC-${filas[0].numero}.`,
    });
  });
}

export type FilaRegistroCompra = {
  ordenId: string;
  numero: number;
  estado: string;
  fechaCompra: string;
  skuCodigo: string;
  producto: string;
  cantidad: number;
  recibida: number;
  valorUnidad: string | null;
  total: string | null;
  formaPago: string | null;
  plataforma: string | null;
  ordenPlataforma: string | null;
  linkCompra: string | null;
  liquidado: string | null;
  fechaEntrega: string | null;
  entregaEstimada: string | null;
  bodega: string;
};

// Una fila por producto de cada OC (las OC viejas de varios SKU salen
// en varias filas). Buscador sobre producto, SKU, plataforma, orden de
// la plataforma, OC-N, forma de pago y fecha: un solo patrón ILIKE con
// los comodines escapados, nunca texto del usuario dentro del SQL.
export async function listarRegistroCompras(empresaId: string, buscar?: string | null): Promise<FilaRegistroCompra[]> {
  const patron = patronBusquedaLike(buscar ?? null);
  const fechaCompra = sql<string>`coalesce(${ordenesCompra.fechaCompra}, (${ordenesCompra.creadoTs} at time zone 'America/Bogota')::date)::text`;
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        ordenId: ordenesCompra.id,
        numero: ordenesCompra.numero,
        estado: ordenesCompra.estado,
        fechaCompra,
        skuCodigo: skus.codigo,
        producto: skus.nombre,
        cantidad: ordenCompraItems.cantidadPedida,
        recibida: ordenCompraItems.cantidadRecibida,
        valorUnidad: ordenCompraItems.costoUnitario,
        total: sql<string | null>`(${ordenCompraItems.cantidadPedida} * ${ordenCompraItems.costoUnitario})::numeric(16,2)::text`,
        formaPago: ordenesCompra.formaPago,
        plataforma: ordenesCompra.plataforma,
        ordenPlataforma: ordenesCompra.ordenPlataforma,
        linkCompra: ordenesCompra.linkCompra,
        liquidado: ordenesCompra.fechaPago,
        fechaEntrega: sql<string | null>`(select (max(${recepciones.recibidoTs}) at time zone 'America/Bogota')::date::text from ${recepciones} where ${recepciones.empresaId} = ${ordenesCompra.empresaId} and ${recepciones.ordenCompraId} = ${ordenesCompra.id})`,
        entregaEstimada: ordenesCompra.entregaEstimada,
        bodega: bodegas.nombre,
      })
      .from(ordenCompraItems)
      .innerJoin(ordenesCompra, and(eq(ordenesCompra.empresaId, ordenCompraItems.empresaId), eq(ordenesCompra.id, ordenCompraItems.ordenCompraId)))
      .innerJoin(skus, and(eq(skus.empresaId, ordenCompraItems.empresaId), eq(skus.id, ordenCompraItems.skuId)))
      .innerJoin(bodegas, and(eq(bodegas.empresaId, ordenesCompra.empresaId), eq(bodegas.id, ordenesCompra.bodegaDestinoId)))
      .where(
        and(
          eq(ordenCompraItems.empresaId, empresaId),
          patron === null
            ? undefined
            : or(
                sql`${skus.nombre} ilike ${patron}`,
                sql`${skus.codigo} ilike ${patron}`,
                sql`${ordenesCompra.plataforma} ilike ${patron}`,
                sql`${ordenesCompra.ordenPlataforma} ilike ${patron}`,
                sql`${ordenesCompra.formaPago} ilike ${patron}`,
                sql`('OC-' || ${ordenesCompra.numero}) ilike ${patron}`,
                sql`${fechaCompra} ilike ${patron}`
              )
        )
      )
      .orderBy(desc(fechaCompra), desc(ordenesCompra.numero), asc(skus.codigo))
      .limit(500)
  );
}

async function validarSkusSimplesTx(tx: typeof db, empresaId: string, skuIds: string[]) {
  const filas = await tx
    .select({ id: skus.id, esKit: skus.esKit })
    .from(skus)
    .where(and(eq(skus.empresaId, empresaId), inArray(skus.id, skuIds)));
  if (filas.length !== new Set(skuIds).size) throw new SkuNoValidoParaStockError("Uno de los SKU no existe en esta empresa.");
  if (filas.some((f) => f.esKit)) throw new SkuNoValidoParaStockError("Un kit no se compra: se compran sus componentes.");
}

export async function listarOrdenesCompra(empresaId: string) {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: ordenesCompra.id,
        numero: ordenesCompra.numero,
        estado: ordenesCompra.estado,
        creadoTs: ordenesCompra.creadoTs,
        proveedor: terceros.nombre,
        bodega: bodegas.nombre,
        lineas: sql<number>`(select count(*)::int from ${ordenCompraItems} where ${ordenCompraItems.ordenCompraId} = ${ordenesCompra.id})`,
      })
      .from(ordenesCompra)
      .innerJoin(bodegas, and(eq(bodegas.empresaId, ordenesCompra.empresaId), eq(bodegas.id, ordenesCompra.bodegaDestinoId)))
      .leftJoin(terceros, and(eq(terceros.empresaId, ordenesCompra.empresaId), eq(terceros.id, ordenesCompra.terceroId)))
      .where(eq(ordenesCompra.empresaId, empresaId))
      .orderBy(desc(ordenesCompra.numero))
      .limit(100)
  );
}

export async function obtenerOrdenCompra(empresaId: string, ordenId: string) {
  if (!esUuid(ordenId)) return null;
  return dbComoEmpresa(empresaId, async (tx) => {
    const [orden] = await tx
      .select({
        id: ordenesCompra.id,
        numero: ordenesCompra.numero,
        estado: ordenesCompra.estado,
        nota: ordenesCompra.nota,
        creadoTs: ordenesCompra.creadoTs,
        bodegaDestinoId: ordenesCompra.bodegaDestinoId,
        bodega: bodegas.nombre,
        proveedor: terceros.nombre,
        fechaCompra: ordenesCompra.fechaCompra,
        formaPago: ordenesCompra.formaPago,
        plataforma: ordenesCompra.plataforma,
        ordenPlataforma: ordenesCompra.ordenPlataforma,
        linkCompra: ordenesCompra.linkCompra,
        entregaEstimada: ordenesCompra.entregaEstimada,
        fechaPago: ordenesCompra.fechaPago,
        medioPago: ordenesCompra.medioPago,
      })
      .from(ordenesCompra)
      .innerJoin(bodegas, and(eq(bodegas.empresaId, ordenesCompra.empresaId), eq(bodegas.id, ordenesCompra.bodegaDestinoId)))
      .leftJoin(terceros, and(eq(terceros.empresaId, ordenesCompra.empresaId), eq(terceros.id, ordenesCompra.terceroId)))
      .where(and(eq(ordenesCompra.empresaId, empresaId), eq(ordenesCompra.id, ordenId)));
    if (!orden) return null;
    const lineas = await tx
      .select({
        id: ordenCompraItems.id,
        skuId: ordenCompraItems.skuId,
        codigo: skus.codigo,
        nombre: skus.nombre,
        cantidadPedida: ordenCompraItems.cantidadPedida,
        cantidadRecibida: ordenCompraItems.cantidadRecibida,
        costoUnitario: ordenCompraItems.costoUnitario,
      })
      .from(ordenCompraItems)
      .innerJoin(skus, and(eq(skus.empresaId, ordenCompraItems.empresaId), eq(skus.id, ordenCompraItems.skuId)))
      .where(and(eq(ordenCompraItems.empresaId, empresaId), eq(ordenCompraItems.ordenCompraId, ordenId)))
      .orderBy(asc(skus.codigo));
    return { ...orden, lineas };
  });
}

export type ResultadoRecepcion = { recepcionId: string; yaRegistrada: boolean };

// recepcionId lo genera el formulario al abrirse (campo oculto): un
// doble clic en "Recibir" manda el mismo id, y la segunda vez no suma
// nada (la clave del kardex es "recepcion:<id>").
export async function registrarRecepcion(
  empresaId: string,
  usuarioId: string,
  datos: {
    recepcionId: string;
    ordenCompraId: string | null;
    bodegaId: string;
    nota: string | null;
    lineas: { skuId: string; cantidad: number }[];
  }
): Promise<ResultadoRecepcion> {
  if (!esUuid(datos.recepcionId)) throw new CompraInvalidaError("El formulario está vencido: recarga la página.");
  const lineas = datos.lineas.filter((l) => l.cantidad !== 0);
  if (lineas.length === 0) throw new CompraInvalidaError("No hay ninguna cantidad recibida.");
  if (!esUuid(datos.bodegaId)) throw new CompraInvalidaError("Elige la bodega donde llegó.");
  if (datos.ordenCompraId !== null && !esUuid(datos.ordenCompraId)) throw new CompraInvalidaError("Esa orden de compra no existe en esta empresa.");
  if (!lineas.every((l) => esUuid(l.skuId))) throw new SkuNoValidoParaStockError("Elige un SKU de la lista.");
  sinSkusRepetidos(lineas);
  for (const l of lineas) validarCantidad("entrada", l.cantidad);

  return dbComoEmpresa(empresaId, async (tx) => {
    const [ya] = await tx
      .select({ id: recepciones.id })
      .from(recepciones)
      .where(and(eq(recepciones.empresaId, empresaId), eq(recepciones.id, datos.recepcionId)));
    if (ya) return { recepcionId: ya.id, yaRegistrada: true };

    await validarSkusSimplesTx(tx, empresaId, lineas.map((l) => l.skuId));

    let lineaOcPorSku = new Map<string, string>();
    let numeroOc: number | null = null;
    if (datos.ordenCompraId) {
      const [orden] = await tx
        .select({ id: ordenesCompra.id, numero: ordenesCompra.numero, estado: ordenesCompra.estado, bodegaDestinoId: ordenesCompra.bodegaDestinoId })
        .from(ordenesCompra)
        .where(and(eq(ordenesCompra.empresaId, empresaId), eq(ordenesCompra.id, datos.ordenCompraId)))
        .for("update");
      if (!orden) throw new CompraInvalidaError("Esa orden de compra no existe en esta empresa.");
      if (orden.estado === "anulada" || orden.estado === "recibida") throw new CompraInvalidaError("Esa orden de compra ya está cerrada.");
      numeroOc = orden.numero;
      const itemsOc = await tx
        .select({ id: ordenCompraItems.id, skuId: ordenCompraItems.skuId })
        .from(ordenCompraItems)
        .where(and(eq(ordenCompraItems.empresaId, empresaId), eq(ordenCompraItems.ordenCompraId, orden.id)));
      lineaOcPorSku = new Map(itemsOc.map((i) => [i.skuId, i.id]));
      if (lineas.some((l) => !lineaOcPorSku.has(l.skuId))) {
        throw new CompraInvalidaError("Llegó un SKU que no está en la orden: regístralo como ingreso directo.");
      }
    }

    await tx.insert(recepciones).values({
      id: datos.recepcionId,
      empresaId,
      ordenCompraId: datos.ordenCompraId,
      bodegaId: datos.bodegaId,
      nota: datos.nota,
      recibidoPor: usuarioId,
    });
    await tx.insert(recepcionItems).values(
      lineas.map((l) => ({
        empresaId,
        recepcionId: datos.recepcionId,
        skuId: l.skuId,
        cantidad: l.cantidad,
        ordenCompraItemId: lineaOcPorSku.get(l.skuId) ?? null,
      }))
    );

    // aplicarMovimientosTx valida que la bodega exista y esté activa.
    await aplicarMovimientosTx(tx, empresaId, {
      claveIdempotencia: `recepcion:${datos.recepcionId}`,
      origen: "recepcion",
      referenciaId: datos.recepcionId,
      actor: { tipo: "persona", usuarioId },
      // 27-nov: el kardex dice de qué OC son las unidades («OC-12 · nota»).
      nota: notaRecepcion(numeroOc, datos.nota),
      lineas: lineas.map((l) => ({ tipo: "entrada" as const, bodegaId: datos.bodegaId, skuId: l.skuId, cantidad: l.cantidad })),
    });

    if (datos.ordenCompraId) {
      for (const l of lineas) {
        await tx
          .update(ordenCompraItems)
          .set({ cantidadRecibida: sql`${ordenCompraItems.cantidadRecibida} + ${l.cantidad}` })
          .where(and(eq(ordenCompraItems.empresaId, empresaId), eq(ordenCompraItems.id, lineaOcPorSku.get(l.skuId)!)));
      }
      const items = await tx
        .select({ pedida: ordenCompraItems.cantidadPedida, recibida: ordenCompraItems.cantidadRecibida })
        .from(ordenCompraItems)
        .where(and(eq(ordenCompraItems.empresaId, empresaId), eq(ordenCompraItems.ordenCompraId, datos.ordenCompraId)));
      const completa = items.every((i) => i.recibida >= i.pedida);
      await tx
        .update(ordenesCompra)
        .set({ estado: completa ? "recibida" : "parcial", actualizadoTs: new Date() })
        .where(and(eq(ordenesCompra.empresaId, empresaId), eq(ordenesCompra.id, datos.ordenCompraId)));
    }

    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.recepcion_registrada",
      entidad: "recepciones",
      entidadId: datos.recepcionId,
      detalle: `${lineas.reduce((n, l) => n + l.cantidad, 0)} unidad(es) de ${lineas.length} SKU${datos.ordenCompraId ? " contra una OC" : " (ingreso directo)"}.`,
    });
    return { recepcionId: datos.recepcionId, yaRegistrada: false };
  });
}

// Solo una OC sin nada recibido se anula: si ya entró mercancía, esa
// entrada es real y se corrige con un ajuste, no borrando la OC.
export async function anularOrdenCompra(empresaId: string, usuarioId: string, ordenId: string): Promise<void> {
  if (!esUuid(ordenId)) throw new CompraInvalidaError("Esa orden de compra no existe en esta empresa.");
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .update(ordenesCompra)
      .set({ estado: "anulada", actualizadoTs: new Date() })
      .where(and(eq(ordenesCompra.empresaId, empresaId), eq(ordenesCompra.id, ordenId), eq(ordenesCompra.estado, "abierta")))
      .returning({ id: ordenesCompra.id });
    if (filas.length === 0) throw new CompraInvalidaError("Solo se puede anular una orden abierta, sin nada recibido.");
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "inventario.orden_compra_anulada",
      entidad: "ordenes_compra",
      entidadId: ordenId,
    });
  });
}

// Sugerencias de «Forma de pago» del Registro de compras: las que ya se
// usaron en compras de la empresa (MATEO AMEX…) y, si la persona puede
// ver Finanzas, las cuentas activas de Disponible. Se escribe libre
// igual: las tarjetas de crédito no son cuentas de Disponible.
export async function sugerenciasFormaPago(empresaId: string, incluirDisponible: boolean): Promise<string[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const usadas = await tx
      .selectDistinct({ nombre: ordenesCompra.formaPago })
      .from(ordenesCompra)
      .where(and(eq(ordenesCompra.empresaId, empresaId), sql`${ordenesCompra.formaPago} is not null`))
      .limit(50);
    const cuentas = incluirDisponible
      ? await tx
          .select({ nombre: cuentasDisponible.nombre })
          .from(cuentasDisponible)
          .where(and(eq(cuentasDisponible.empresaId, empresaId), eq(cuentasDisponible.activa, true)))
          .limit(50)
      : [];
    const nombres = [...usadas, ...cuentas].map((f) => f.nombre).filter((n): n is string => !!n);
    return [...new Set(nombres)].sort((a, b) => a.localeCompare(b, "es"));
  });
}
