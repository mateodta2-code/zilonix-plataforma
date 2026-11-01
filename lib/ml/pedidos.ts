import { and, asc, desc, eq, gte, ilike, lt, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidoEventos, pedidos } from "@/db/schema";
import { acotarPagina, limitesDiaBogota, parsearPagina, patronBusquedaLike } from "@/lib/filtros-listado";
import { esUuid } from "@/lib/validacion";

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
export const ESTADOS_PEDIDO_FILTRO = [
  { valor: "confirmed", etiqueta: "Confirmado" },
  { valor: "payment_required", etiqueta: "Pago pendiente" },
  { valor: "payment_in_process", etiqueta: "Pago en proceso" },
  { valor: "paid", etiqueta: "Pagado" },
  { valor: "cancelled", etiqueta: "Cancelado" },
  { valor: "invalid", etiqueta: "Inválido" },
] as const;

// Bug real reportado en la tabla de Pedidos: la columna ESTADO
// mostraba el valor crudo de Mercado Libre ("PAID") en vez de la
// etiqueta en español que el filtro de arriba ya usa ("Pagado") — dos
// fuentes de verdad para lo mismo. Una sola función, reusando
// ESTADOS_PEDIDO_FILTRO tal cual (nunca una segunda lista de
// traducciones que se pueda desincronizar). Comparación sin
// mayúsculas/minúsculas a propósito: el valor real guardado en
// pedidos.estado (texto plano, lo que haya mandado Mercado Libre en
// ese pedido) no tiene garantía de casing consistente — "PAID"/"paid"
// tienen que traducir igual. Un estado que de verdad no está en la
// lista (ver el comentario de ESTADOS_PEDIDO_FILTRO, arriba: puede
// pasar, esta lista no tiene precedente confirmado contra producción)
// muestra el valor ORIGINAL tal cual llegó, nunca se rompe ni se
// inventa una etiqueta.
const ETIQUETAS_POR_ESTADO = new Map<string, string>(ESTADOS_PEDIDO_FILTRO.map((e) => [e.valor, e.etiqueta]));

export function etiquetaEstadoPedido(estado: string): string {
  return ETIQUETAS_POR_ESTADO.get(estado.toLowerCase()) ?? estado;
}

export const ORDENES_PEDIDO_FILTRO = ["fecha_desc", "fecha_asc", "total_desc", "total_asc"] as const;
export type OrdenPedidos = (typeof ORDENES_PEDIDO_FILTRO)[number];

export type FiltroPedidos = {
  busqueda?: string;
  estado?: string;
  desde?: string; // "YYYY-MM-DD", hora de Colombia
  hasta?: string; // "YYYY-MM-DD", hora de Colombia
  orden?: string;
  // La página lo recibe como string (o el primer valor de un string[]);
  // las pruebas lo pasan como número. parsearPagina acepta los dos.
  pagina?: number | string;
};

export const TAMANO_PAGINA_PEDIDOS = 25;

export type ResultadoPedidos = {
  pedidos: (typeof pedidos.$inferSelect)[];
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

  return dbComoEmpresa(empresaId, async (tx) => {
    const condicion = and(...condiciones);

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(pedidos)
      .where(condicion);

    const totalPaginas = Math.max(1, Math.ceil(total / TAMANO_PAGINA_PEDIDOS));
    // El offset se calcula con la página ya acotada. Si se usara
    // paginaPedida, ?pagina=99 con 30 pedidos devolvería 0 filas y la
    // pantalla diría que no hay pedidos.
    const pagina = acotarPagina(paginaPedida, totalPaginas);

    const filas = await tx
      .select()
      .from(pedidos)
      .where(condicion)
      .orderBy(columnaOrden, ordenId)
      .limit(TAMANO_PAGINA_PEDIDOS)
      .offset((pagina - 1) * TAMANO_PAGINA_PEDIDOS);

    return { pedidos: filas, total, pagina, totalPaginas };
  });
}

export type EventoPedido = { paso: PasoPedido; ts: Date; actorTipo: "persona" | "sistema"; detalle: string | null };

// Tarea 2.7 — "ves venta, pago, despacho y entrega con fecha, hora y
// quién". "Quién" para un evento de sistema siempre es "Sistema /
// integración ML" (mismo criterio de la tarea 1.9 — nunca se le
// atribuye a una persona lo que confirmó la API sola). Las pantallas
// nunca reciben el usuarioId crudo, solo lo ya resuelto acá.
// Falla cerrada (bug real en vivo, digest 960283135, staging): pedidos.id
// es una columna uuid — un pedidoId que no tiene forma de UUID (ej.
// "sso-callback", colado por un redirect de Clerk sobre una ruta
// dinámica) hace que eq(pedidos.id, pedidoId) reviente Postgres con
// 22P02 en vez de simplemente no encontrar nada. La página de arriba ya
// valida esto antes de llegar acá, pero esta función es la única fuente
// de verdad real: cualquier otro caller futuro queda protegido igual,
// sin tener que acordarse de repetir la validación en cada sitio.
export async function obtenerPedidoConEventos(empresaId: string, pedidoId: string) {
  if (!esUuid(pedidoId)) return null;
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
