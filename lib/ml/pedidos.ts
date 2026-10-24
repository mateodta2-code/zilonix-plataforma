import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, despachosMl, pedidoEventos, pedidos } from "@/db/schema";
import { acotarPagina, limitesDiaBogota, parsearPagina, patronBusquedaLike } from "@/lib/filtros-listado";

export type PasoPedido = (typeof pedidoEventos.$inferInsert)["paso"];

// Tarea 2.7 — los 8 pasos del plan maestro, en orden fijo. La pantalla
// de detalle siempre los muestra en este orden, tengan evento o no —
// nunca reordenados ni con pasos sueltos.
export const PASOS_PEDIDO: PasoPedido[] = [
  "venta",
  "pago",
  "factura",
  "empaque",
  "despacho",
  "entrega",
  "novedades",
  "dinero_conciliado",
];

// Siempre actor "sistema" — todo lo que llena un evento de pedido hoy
// viene de confirmar el dato real contra la API de Mercado Libre
// (tarea 2.5/2.7), nunca de una persona a mano todavía.
export async function registrarEventoPedido(
  empresaId: string,
  pedidoId: string,
  paso: PasoPedido,
  ts: Date,
  detalle?: string
): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(pedidoEventos)
      .values({ empresaId, pedidoId, paso, ts, actorTipo: "sistema", detalle })
      .onConflictDoNothing({ target: [pedidoEventos.pedidoId, pedidoEventos.paso] })
  );
}

// Issue "tabla completa de pedidos" — valores reales de order.status de
// la API de Mercado Libre (documentados públicamente por ML). OJO: a
// diferencia del resto de lib/ml/ (confirmado contra el código real que
// ya corre en producción en zilonix-os-web), esta lista NO tiene
// precedente ahí — ese sistema solo revisa el status del PAGO
// ("approved"), nunca el status de la ORDEN. Si algún pedido real trae
// un valor fuera de esta lista, el filtro de "Estado" simplemente no lo
// va a poder elegir (no rompe nada, pero tampoco sirve) — confirmar y
// ajustar esta lista con un pedido real apenas haya uno en staging.
// Etiquetas en femenino (la venta), las mismas que pinta
// estadoVisiblePedido en la lista (#166); los valores no cambian.
export const ESTADOS_PEDIDO_FILTRO = [
  { valor: "confirmed", etiqueta: "Confirmada" },
  { valor: "payment_required", etiqueta: "Pago pendiente" },
  { valor: "payment_in_process", etiqueta: "Pago en proceso" },
  { valor: "paid", etiqueta: "Pagada" },
  { valor: "cancelled", etiqueta: "Cancelada" },
  { valor: "invalid", etiqueta: "Inválida" },
] as const;

export const ORDENES_PEDIDO_FILTRO = ["fecha_desc", "fecha_asc", "total_desc", "total_asc"] as const;
export type OrdenPedidos = (typeof ORDENES_PEDIDO_FILTRO)[number];

export type FiltroPedidos = {
  busqueda?: string;
  estado?: string;
  desde?: string; // "YYYY-MM-DD", hora de Colombia
  hasta?: string; // "YYYY-MM-DD", hora de Colombia
  orden?: string;
  // Id de cuentas_ml ya validado por la página con leerCuentaMlDeQuery
  // (lib/ml/selector-cuenta.ts): null o ausente = Todas. Igual va dentro
  // de dbComoEmpresa y con empresaId en el WHERE: un id de otra empresa
  // da 0 filas, nunca las de esa empresa.
  cuentaId?: string | null;
  // La página lo recibe como string (o el primer valor de un string[]);
  // las pruebas lo pasan como número. parsearPagina acepta los dos.
  pagina?: number | string;
};

export const TAMANO_PAGINA_PEDIDOS = 25;

// Fila de la lista (#166): el pedido, el apodo de su cuenta de ML
// (cuentas_ml.nickname — ninguna otra columna de cuentas_ml, ni tokens
// ni ids externos) y el status de su despacho más reciente (null = sin
// despacho guardado).
export type PedidoListado = typeof pedidos.$inferSelect & {
  apodoCuenta: string;
  estadoEnvio: string | null;
};

export type ResultadoPedidos = {
  pedidos: PedidoListado[];
  total: number;
  pagina: number;
  totalPaginas: number;
};

// Issue "tabla completa de pedidos" — búsqueda, filtro y orden, todo
// validado ACÁ (no solo en la página): cualquier valor de estado/orden
// que no esté en las listas de arriba se ignora en silencio (nunca un
// error 500 por un ?estado= raro en la URL), y la búsqueda de texto usa
// ilike() de Drizzle (parámetro real, nunca texto del usuario pegado a
// mano en el SQL). El patrón escapa \, % y _ con la barra invertida,
// que es el escape por defecto de LIKE/ILIKE en Postgres — ilike() no
// manda cláusula ESCAPE, así que hay que usar esa barra y no otra.
// "Comprador" y "SKU" NO se pueden buscar todavía: la tabla pedidos no
// guarda comprador, y el enlace con SKU es tarea futura (ver el
// comentario de publicaciones.skuId en db/schema.ts) — buscar solo
// filtra por número de pedido hasta que esos datos existan.
export async function listarPedidosFiltrados(empresaId: string, filtro: FiltroPedidos = {}): Promise<ResultadoPedidos> {
  const condiciones = [eq(pedidos.empresaId, empresaId)];

  const patron = patronBusquedaLike(filtro.busqueda);
  if (patron) {
    condiciones.push(ilike(pedidos.pedidoIdExterno, patron));
  }
  if (filtro.estado && ESTADOS_PEDIDO_FILTRO.some((e) => e.valor === filtro.estado)) {
    condiciones.push(eq(pedidos.estado, filtro.estado));
  }
  const desde = limitesDiaBogota(filtro.desde);
  if (desde) condiciones.push(gte(pedidos.fecha, desde.inicio));
  // hasta es exclusivo: < 00:00 del día siguiente en Bogotá (05:00 UTC),
  // no <= 23:59:59.999. Así entra un pedido de las 23:59:59.500 y queda
  // afuera uno de las 00:00:00 del día siguiente.
  const hasta = limitesDiaBogota(filtro.hasta);
  if (hasta) condiciones.push(lt(pedidos.fecha, hasta.finExclusivo));
  if (filtro.cuentaId) condiciones.push(eq(pedidos.cuentaMlId, filtro.cuentaId));

  const ordenValido = (ORDENES_PEDIDO_FILTRO as readonly string[]).includes(filtro.orden ?? "") ? (filtro.orden as OrdenPedidos) : "fecha_desc";
  const columnaOrden = {
    fecha_desc: desc(pedidos.fecha),
    fecha_asc: asc(pedidos.fecha),
    total_desc: desc(pedidos.total),
    total_asc: asc(pedidos.total),
  }[ordenValido];
  // Sin un desempate, dos pedidos con la misma fecha (o el mismo total)
  // pueden salir en distinto orden en cada página y un mismo id aparece
  // dos veces o se pierde entre el límite y el offset. El id va en la
  // misma dirección que la columna principal.
  const descendente = ordenValido.endsWith("_desc");
  const ordenId = descendente ? desc(pedidos.id) : asc(pedidos.id);

  const paginaPedida = parsearPagina(filtro.pagina);

  // Inner join: cuenta_ml_id es notNull, así que ningún pedido se pierde.
  // El mismo join en el conteo y en la página, para que "Mostrando X–Y
  // de Z" nunca se desalinee con las filas.
  const unionCuenta = and(eq(cuentasMl.id, pedidos.cuentaMlId), eq(cuentasMl.empresaId, empresaId));

  return dbComoEmpresa(empresaId, async (tx) => {
    const condicion = and(...condiciones);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(pedidos)
      .innerJoin(cuentasMl, unionCuenta)
      .where(condicion);

    const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_PEDIDOS));
    // El offset se calcula con la página ya acotada. Si se usara
    // paginaPedida, ?pagina=99 con 30 pedidos devolvería 0 filas y la
    // pantalla diría que no hay pedidos.
    const pagina = acotarPagina(paginaPedida, totalPaginas);

    const filas = await tx
      .select({ ...getTableColumns(pedidos), apodoCuenta: cuentasMl.nickname })
      .from(pedidos)
      .innerJoin(cuentasMl, unionCuenta)
      .where(condicion)
      .orderBy(columnaOrden, ordenId)
      .limit(TAMANO_PAGINA_PEDIDOS)
      .offset((pagina - 1) * TAMANO_PAGINA_PEDIDOS);

    // Estado del envío en una segunda consulta, solo para los pedidos de
    // esta página. Un left join a despachos_ml en la consulta de arriba
    // duplicaría la fila del pedido que tiene dos despachos y correría el
    // conteo y la paginación. Con más de uno se queda el de
    // actualizado_ts más reciente (el id desempata, para que no cambie
    // entre cargas).
    const estadoEnvioPorPedido = new Map<string, string | null>();
    if (filas.length > 0) {
      const despachos = await tx
        .select({ pedidoId: despachosMl.pedidoId, status: despachosMl.status, actualizadoTs: despachosMl.actualizadoTs })
        .from(despachosMl)
        .where(and(eq(despachosMl.empresaId, empresaId), inArray(despachosMl.pedidoId, filas.map((fila) => fila.id))))
        .orderBy(desc(despachosMl.actualizadoTs), desc(despachosMl.id));
      for (const despacho of despachos) {
        if (!estadoEnvioPorPedido.has(despacho.pedidoId)) estadoEnvioPorPedido.set(despacho.pedidoId, despacho.status);
      }
    }

    return {
      pedidos: filas.map((fila) => ({ ...fila, estadoEnvio: estadoEnvioPorPedido.get(fila.id) ?? null })),
      total,
      pagina,
      totalPaginas,
    };
  });
}

export type EventoPedido = { paso: PasoPedido; ts: Date; actorTipo: "persona" | "sistema"; detalle: string | null };

// Tarea 2.7 — "ves venta, pago, despacho y entrega con fecha, hora y
// quién". "Quién" para un evento de sistema siempre es "Sistema /
// integración ML" (mismo criterio de la tarea 1.9 — nunca se le
// atribuye a una persona lo que confirmó la API sola). Las pantallas
// nunca reciben el usuarioId crudo, solo lo ya resuelto acá.
export async function obtenerPedidoConEventos(empresaId: string, pedidoId: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [pedido] = await tx.select().from(pedidos).where(eq(pedidos.id, pedidoId));
    if (!pedido) return null;
    const eventos = await tx
      .select({ paso: pedidoEventos.paso, ts: pedidoEventos.ts, actorTipo: pedidoEventos.actorTipo, detalle: pedidoEventos.detalle })
      .from(pedidoEventos)
      .where(eq(pedidoEventos.pedidoId, pedidoId))
      .orderBy(asc(pedidoEventos.ts));
    return { pedido, eventos: eventos as EventoPedido[] };
  });
}
