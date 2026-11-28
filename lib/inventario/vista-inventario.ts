import { and, asc, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import type { db } from "@/db";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas, kardexMovimientos, skus, stockBodega, usuarios } from "@/db/schema";
import { escaparComodinesLike, normalizarTextoBusqueda } from "@/lib/filtros-listado";
import { fechaIsoBogota } from "@/lib/csv-exportar";
import type { TipoMovimiento } from "@/lib/inventario/calculos";

// Issue #280 — vista de /panel/inventario «como Zilonix OS»: una fila
// por SKU+bodega, el historial del producto en un emergente y la
// validación del formulario «Modificar». Solo LEE: el stock lo escribe
// únicamente aplicarMovimientos (lib/inventario/movimientos.ts). No
// reemplaza listarInventario/listarKardex (lib/inventario/stock.ts),
// que siguen usando otras pantallas.

type Tx = typeof db;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function esUuidValido(valor: unknown): valor is string {
  return typeof valor === "string" && UUID_RE.test(valor);
}

// ---------- Tabla: una fila por SKU + bodega ----------

export type FilaInventarioBodega = {
  skuId: string;
  codigo: string;
  nombre: string;
  esKit: boolean;
  // null = el SKU no tiene saldo en ninguna bodega (o es kit): «—».
  bodegaId: string | null;
  bodegaNombre: string | null;
  // Disponible de ESA bodega (nunca disponible+reservado). null en kits.
  disponible: number | null;
};

export const TAMANO_PAGINA_INVENTARIO_BODEGA = 50;
export const TOPE_EXPORTAR_INVENTARIO_BODEGA = 20_000;

export function claveFilaInventario(f: { skuId: string; bodegaId: string | null }): string {
  return `${f.skuId}-${f.bodegaId ?? "sin"}`;
}

// Mismo filtro de búsqueda que listarInventario (código o nombre); el
// patrón entra como VALOR de ilike, nunca dentro de sql``.
function condicionesBusqueda(empresaId: string, busqueda: string | null | undefined): SQL | undefined {
  const condiciones: SQL[] = [eq(skus.empresaId, empresaId)];
  if (busqueda) {
    const patron = `%${escaparComodinesLike(busqueda)}%`;
    condiciones.push(or(ilike(skus.codigo, patron), ilike(skus.nombre, patron))!);
  }
  return and(...condiciones);
}

// Saldos que se muestran: bodegas activas, más las desactivadas que
// todavía tienen algo (mismo criterio que stockPorBodegaDeSkus: si no,
// ese stock "desaparecería"). Subconsulta para que el LEFT JOIN deje
// una fila con bodega «—» al SKU que no tiene ninguno.
function saldosVisiblesTx(tx: Tx, empresaId: string) {
  return tx
    .select({
      skuId: stockBodega.skuId,
      bodegaId: stockBodega.bodegaId,
      disponible: stockBodega.disponible,
      bodegaNombre: bodegas.nombre,
    })
    .from(stockBodega)
    .innerJoin(bodegas, and(eq(bodegas.empresaId, stockBodega.empresaId), eq(bodegas.id, stockBodega.bodegaId)))
    .where(and(eq(stockBodega.empresaId, empresaId), or(eq(bodegas.activa, true), ne(stockBodega.disponible, 0), ne(stockBodega.reservado, 0))))
    .as("saldos_visibles");
}

function consultaFilasTx(tx: Tx, empresaId: string, busqueda: string | null | undefined) {
  const sb = saldosVisiblesTx(tx, empresaId);
  // Un kit no tiene saldo propio: nunca se une a stock_bodega.
  const union = and(eq(sb.skuId, skus.id), eq(skus.esKit, false));
  return {
    filas: () =>
      tx
        .select({
          skuId: skus.id,
          codigo: skus.codigo,
          nombre: skus.nombre,
          esKit: skus.esKit,
          bodegaId: sb.bodegaId,
          bodegaNombre: sb.bodegaNombre,
          disponible: sb.disponible,
        })
        .from(skus)
        .leftJoin(sb, union)
        .where(condicionesBusqueda(empresaId, busqueda))
        .orderBy(asc(skus.codigo), asc(sb.bodegaNombre), asc(skus.id), asc(sb.bodegaId)),
    total: () => tx.select({ total: sql<number>`count(*)::int` }).from(skus).leftJoin(sb, union).where(condicionesBusqueda(empresaId, busqueda)),
  };
}

function aFila(f: {
  skuId: string;
  codigo: string;
  nombre: string;
  esKit: boolean;
  bodegaId: string | null;
  bodegaNombre: string | null;
  disponible: number | null;
}): FilaInventarioBodega {
  if (f.esKit) return { ...f, bodegaId: null, bodegaNombre: null, disponible: null };
  return { ...f, disponible: f.disponible ?? 0 };
}

// La página es de 50 FILAS (pares SKU+bodega), no de 50 SKU.
export async function listarInventarioPorBodega(
  empresaId: string,
  filtro: { busqueda?: string; pagina?: number } = {}
): Promise<{ filas: FilaInventarioBodega[]; total: number; pagina: number; totalPaginas: number }> {
  const busqueda = normalizarTextoBusqueda(filtro.busqueda);
  return dbComoEmpresa(empresaId, async (tx) => {
    const consulta = consultaFilasTx(tx, empresaId, busqueda);
    const [{ total }] = await consulta.total();
    const totalPaginas = Math.max(1, Math.ceil(Number(total) / TAMANO_PAGINA_INVENTARIO_BODEGA));
    const pagina = Math.min(Math.max(1, Math.trunc(filtro.pagina ?? 1) || 1), totalPaginas);
    const filas = await consulta
      .filas()
      .limit(TAMANO_PAGINA_INVENTARIO_BODEGA)
      .offset((pagina - 1) * TAMANO_PAGINA_INVENTARIO_BODEGA);
    return { filas: filas.map(aFila), total: Number(total), pagina, totalPaginas };
  });
}

// Para el CSV: mismas filas y orden, sin páginas, hasta el tope (se
// pide una de más para saber si quedó algo afuera).
export async function listarInventarioPorBodegaParaExportar(
  empresaId: string,
  filtro: { busqueda?: string } = {},
  tope: number = TOPE_EXPORTAR_INVENTARIO_BODEGA
): Promise<{ filas: FilaInventarioBodega[]; recortado: boolean }> {
  const busqueda = normalizarTextoBusqueda(filtro.busqueda);
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await consultaFilasTx(tx, empresaId, busqueda).filas().limit(tope + 1);
    return { filas: filas.slice(0, tope).map(aFila), recortado: filas.length > tope };
  });
}

// ---------- Historial del producto (emergente) ----------

export const TAMANO_PAGINA_HISTORIAL_PRODUCTO = 50;
export const TOPE_HISTORIAL_PRODUCTO = 100;

export type CambioStock = "sube" | "baja" | "sin_cambio";

export type FilaHistorialProducto = {
  id: string;
  fecha: string; // AAAA-MM-DD HH:mm, Bogotá
  usuario: string;
  antes: number;
  despues: number;
  cambio: CambioStock;
  detalle: string;
};

export class HistorialInvalidoError extends Error {
  constructor() {
    super("Ese producto no existe en tu empresa.");
    this.name = "HistorialInvalidoError";
  }
}

// 2026-11-27T14:05:00-05:00 → 2026-11-27 14:05.
export function fechaHoraBogota(fecha: Date): string {
  return fechaIsoBogota(fecha).slice(0, 16).replace("T", " ");
}

export function claseCambioStock(antes: number, despues: number): CambioStock {
  if (despues > antes) return "sube";
  if (despues < antes) return "baja";
  return "sin_cambio";
}

function unidades(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? "unidad" : "unidades"}`;
}

const NOMBRE_TIPO: Record<TipoMovimiento, string> = {
  entrada: "Ingreso",
  salida: "Salida",
  ajuste: "Ajuste",
  traslado: "Traslado",
  reserva: "Reserva",
  liberacion: "Liberación",
  confirmacion: "Venta confirmada",
};

// La nota del movimiento si la tiene; si no, un texto según el tipo.
// Reserva/liberación/confirmación mueven el reservado: la cantidad sale
// de ahí cuando el disponible no cambió.
export function textoDetalleMovimiento(m: { tipo: TipoMovimiento; deltaDisponible: number; deltaReservado?: number; nota: string | null }): string {
  const nota = m.nota?.trim();
  if (nota) return nota;
  if (m.tipo === "traslado") return "Traslado";
  if (m.tipo === "ajuste") return `Ajuste ${m.deltaDisponible >= 0 ? "+" : ""}${unidades(m.deltaDisponible)}`;
  const cantidad = Math.abs(m.deltaDisponible) || Math.abs(m.deltaReservado ?? 0);
  return `${NOMBRE_TIPO[m.tipo]} ${unidades(cantidad)}`;
}

// Saldos = stock DISPONIBLE (como Trazabilidad): después = saldo del
// kardex, antes = después − cambio.
export function armarFilaHistorial(m: {
  id: string;
  ts: Date;
  tipo: TipoMovimiento;
  deltaDisponible: number;
  deltaReservado: number;
  saldoDisponible: number;
  actorTipo: "persona" | "sistema";
  actorNombre: string | null;
  nota: string | null;
}): FilaHistorialProducto {
  const despues = m.saldoDisponible;
  const antes = despues - m.deltaDisponible;
  return {
    id: m.id,
    fecha: fechaHoraBogota(m.ts),
    usuario: m.actorTipo === "sistema" ? "Sistema" : m.actorNombre?.trim() || "Persona",
    antes,
    despues,
    cambio: claseCambioStock(antes, despues),
    detalle: textoDetalleMovimiento(m),
  };
}

// «Ver más» pide la página siguiente: se devuelven las primeras
// pagina×50 filas (tope 100), lo más reciente primero. Los ids llegan
// validados como UUID y entran solo como valores.
export async function listarHistorialProducto(
  empresaId: string,
  filtro: { skuId: string; bodegaId: string | null; pagina?: number }
): Promise<{ filas: FilaHistorialProducto[]; hayMas: boolean }> {
  if (!esUuidValido(filtro.skuId)) throw new HistorialInvalidoError();
  if (filtro.bodegaId !== null && !esUuidValido(filtro.bodegaId)) throw new HistorialInvalidoError();
  const pagina = Math.max(1, Math.trunc(filtro.pagina ?? 1) || 1);
  const limite = Math.min(pagina * TAMANO_PAGINA_HISTORIAL_PRODUCTO, TOPE_HISTORIAL_PRODUCTO);
  const condiciones: SQL[] = [eq(kardexMovimientos.empresaId, empresaId), eq(kardexMovimientos.skuId, filtro.skuId)];
  if (filtro.bodegaId) condiciones.push(eq(kardexMovimientos.bodegaId, filtro.bodegaId));
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({
        id: kardexMovimientos.id,
        ts: kardexMovimientos.ts,
        tipo: kardexMovimientos.tipo,
        deltaDisponible: kardexMovimientos.deltaDisponible,
        deltaReservado: kardexMovimientos.deltaReservado,
        saldoDisponible: kardexMovimientos.saldoDisponible,
        actorTipo: kardexMovimientos.actorTipo,
        actorNombre: usuarios.nombre,
        nota: kardexMovimientos.nota,
      })
      .from(kardexMovimientos)
      .innerJoin(skus, and(eq(skus.empresaId, kardexMovimientos.empresaId), eq(skus.id, kardexMovimientos.skuId)))
      .innerJoin(bodegas, and(eq(bodegas.empresaId, kardexMovimientos.empresaId), eq(bodegas.id, kardexMovimientos.bodegaId)))
      .leftJoin(usuarios, eq(usuarios.id, kardexMovimientos.usuarioId))
      .where(and(...condiciones))
      .orderBy(desc(kardexMovimientos.ts), desc(kardexMovimientos.linea))
      .limit(limite + 1);
    return {
      filas: filas.slice(0, limite).map(armarFilaHistorial),
      hayMas: filas.length > limite && limite < TOPE_HISTORIAL_PRODUCTO,
    };
  });
}

// ---------- Formulario «Modificar»: ingreso o salida ----------

export const LARGO_MAXIMO_NOTA_MODIFICAR = 200;

export class DatosModificarInvalidosError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "DatosModificarInvalidosError";
  }
}

export type MovimientoModificar = {
  tipo: "entrada" | "salida";
  skuId: string;
  bodegaId: string;
  cantidad: number;
  nota: string;
  operacionId: string;
};

// Valida TODO antes de llegar a la base: solo entrada|salida (nunca un
// ajuste con signo), cantidad entera ≥ 1, nota obligatoria y ids UUID.
export function parsearMovimientoModificar(campos: {
  tipo?: unknown;
  skuId?: unknown;
  bodegaId?: unknown;
  cantidad?: unknown;
  nota?: unknown;
  operacionId?: unknown;
}): MovimientoModificar {
  const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const tipo = texto(campos.tipo);
  if (tipo !== "entrada" && tipo !== "salida") throw new DatosModificarInvalidosError("Elige si es un ingreso o una salida.");
  const operacionId = texto(campos.operacionId);
  if (!esUuidValido(operacionId)) throw new DatosModificarInvalidosError("El formulario está vencido: ciérralo y vuelve a abrirlo.");
  const skuId = texto(campos.skuId);
  if (!esUuidValido(skuId)) throw new DatosModificarInvalidosError("Ese producto no existe en tu empresa.");
  const bodegaId = texto(campos.bodegaId);
  if (!esUuidValido(bodegaId)) throw new DatosModificarInvalidosError("Elige una bodega.");
  const cantidadTexto = texto(campos.cantidad);
  const cantidad = /^\d+$/.test(cantidadTexto) ? Number(cantidadTexto) : Number.NaN;
  if (!Number.isSafeInteger(cantidad) || cantidad < 1) throw new DatosModificarInvalidosError("La cantidad tiene que ser un número entero mayor o igual a 1.");
  const nota = texto(campos.nota).replace(/\s+/g, " ");
  if (!nota) throw new DatosModificarInvalidosError("Escribe una nota: por qué entra o sale el stock.");
  if (nota.length > LARGO_MAXIMO_NOTA_MODIFICAR) {
    throw new DatosModificarInvalidosError(`La nota puede tener hasta ${LARGO_MAXIMO_NOTA_MODIFICAR} caracteres.`);
  }
  return { tipo, skuId, bodegaId, cantidad, nota, operacionId };
}
