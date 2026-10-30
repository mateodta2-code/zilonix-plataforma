// Issue #163 (parte de #143) — tablero de /panel/finanzas: ventas,
// recaudo y recaudo promedio diario del mes en curso, contra el mismo
// tramo del mes anterior. Sin migración y sin llamadas a Mercado Libre.
//
// Fuente (cambia respecto al issue, que decía sumar pedidos.total): el
// recaudo sale de pedidos_finanzas.valor_venta, lo que pagó el cliente
// sin restar nada (Sharel, 24-oct), para que CUADRE con el «Detalle día
// a día» de utilidad (lib/finanzas/ventas-consulta.ts). pedidos.total es
// el total_amount de la orden y la sincronización no lo vuelve a
// escribir. El criterio de venta es el mismo del Detalle: estado fuera
// de ESTADOS_QUE_NO_SON_VENTA y sin cancelada en pedidos_finanzas; el
// día es pedidos.fecha (creación en ML, día de Bogotá).
// - Ventas (cantidad): se cuentan en pedidos, con o sin foto financiera,
//   así la cantidad sale completa aunque falte sincronizar alguna.
// - Recaudo: solo las ventas con foto. Las que no la tienen se cuentan
//   aparte (sinSincronizar). Si el tramo anterior tiene ventas sin foto,
//   la variación de recaudo y de promedio es null: nunca se compara
//   contra un mes a medias.
//
// Inicio (#143, capturas de Zilonix OS de Sharel, 29-oct): por cuenta
// (participación y comparativo) y publicidad invertida del tramo actual.
// La publicidad suma SOLO publicidad_metricas_diarias de nivel
// «campana», la misma regla de /panel/publicidad (sumarCuenta en
// lib/publicidad/consultas.ts). El total de nivel «cuenta» no sirve: la
// sincronización no lo guarda cuando la respuesta de ML es ambigua
// (AVISO_DAILY en sincronizarPublicidad.ts), y en el smoke del 30-oct
// STOREKINGSAS quedaba afuera. Sumar los dos niveles lo duplicaría.
// Moneda: las métricas no la traen; Product Ads en Seller es COP en la
// práctica, así que va "COP" fijo.
//
// Utilidad antes de publicidad (#143): sale de listarVentasUtilidad, la
// misma lectura de Finanzas → Ventas, para que cuadre al peso; no hay
// otra fórmula ni otra suma en SQL. Sin publicidad (#135) ni variación
// vs. mes anterior. El % de ventas con costo es sobre las sincronizadas.

import { and, eq, gte, lt, lte, notInArray, or, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, pedidos, pedidosFinanzas, publicidadMetricasDiarias } from "@/db/schema";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { limitesDiaBogota } from "@/lib/filtros-listado";
import { requierePermiso } from "@/lib/permisos";
import type { TotalesDetalle } from "./detalle-ventas";
import { aCentavos, desdeCentavos } from "./utilidad-venta";
import { listarVentasUtilidad } from "./ventas-consulta";
import { porcentajeVentasConCosto } from "./ventas-pantalla";

const CERO = BigInt(0);
const MIL = BigInt(1000);
const DIEZ = BigInt(10);

// ---------------------------------------------------------------------------
// Parte pura: fechas y cuentas, sin base ni reloj
// ---------------------------------------------------------------------------

export type Tramo = { inicio: Date; finExclusivo: Date; desdeTexto: string; hastaTexto: string; dias: number };

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

function limites(fecha: string): { inicio: Date; finExclusivo: Date } {
  const l = limitesDiaBogota(fecha);
  if (!l) throw new Error(`tramosBogota: fecha fuera de rango (${fecha})`);
  return l;
}

function tramo(anio: number, mes: number, hastaDia: number): Tramo {
  const desdeTexto = `${anio}-${dosDigitos(mes)}-01`;
  const hastaTexto = `${anio}-${dosDigitos(mes)}-${dosDigitos(hastaDia)}`;
  return { inicio: limites(desdeTexto).inicio, finExclusivo: limites(hastaTexto).finExclusivo, desdeTexto, hastaTexto, dias: hastaDia };
}

// Actual: del día 1 del mes de Bogotá hasta el fin de HOY (Bogotá),
// exclusivo. Anterior: días 1 a N del mes anterior (N = día de hoy),
// cortado en su último día si es más corto (31-mar → 1–28 feb; en un año
// bisiesto, 1–29 feb). Mismo reloj de Bogotá que rangoDiaBogota y
// mesActualBogota: restar 5h y leer con getters UTC.
export function tramosBogota(ahora: Date): { actual: Tramo; anterior: Tramo } {
  const reloj = new Date(ahora.getTime() - 5 * 60 * 60 * 1000);
  const anio = reloj.getUTCFullYear();
  const mes = reloj.getUTCMonth() + 1;
  const hoy = reloj.getUTCDate();
  const anioAnterior = mes === 1 ? anio - 1 : anio;
  const mesAnterior = mes === 1 ? 12 : mes - 1;
  const ultimoDiaAnterior = new Date(Date.UTC(anioAnterior, mesAnterior, 0)).getUTCDate();
  return { actual: tramo(anio, mes, hoy), anterior: tramo(anioAnterior, mesAnterior, Math.min(hoy, ultimoDiaAnterior)) };
}

// División redondeando la mitad lejos de cero; el divisor tiene que ser > 0.
function dividirRedondeando(dividendo: bigint, divisor: bigint): bigint {
  const negativo = dividendo < CERO;
  const absoluto = negativo ? -dividendo : dividendo;
  const cociente = (absoluto * BigInt(2) + divisor) / (divisor * BigInt(2));
  return negativo ? -cociente : cociente;
}

// Monto ÷ días con 2 decimales exactos (centavos BigInt, half-up).
// 100.00 ÷ 3 = "33.33"; 49553680 ÷ 24 = "2064736.67".
export function promedioDiario(monto: string, dias: number): string {
  if (!Number.isInteger(dias) || dias <= 0) throw new Error(`promedioDiario: días inválidos (${dias})`);
  return desdeCentavos(dividirRedondeando(aCentavos(monto), BigInt(dias)));
}

// (actual − anterior) ÷ anterior × 100 con 1 decimal ("10.4", "-3.0").
// Anterior en 0 → null (en pantalla, "—"). Acepta montos o cantidades
// como texto ("12", "1234.50").
export function variacion(actual: string, anterior: string): string | null {
  const a = aCentavos(actual);
  const b = aCentavos(anterior);
  if (b === CERO) return null;
  const base = b < CERO ? -b : b;
  const decimas = dividirRedondeando((a - b) * MIL, base);
  const negativo = decimas < CERO;
  const absoluto = negativo ? -decimas : decimas;
  return `${negativo ? "-" : ""}${absoluto / DIEZ}.${absoluto % DIEZ}`;
}

// ---------------------------------------------------------------------------
// Consulta
// ---------------------------------------------------------------------------

export type RecaudoMoneda = {
  moneda: string;
  actual: string;
  anterior: string;
  variacion: string | null;
  promedioActual: string;
  promedioAnterior: string;
  variacionPromedio: string | null;
};

export type TableroMes = {
  tramo: { desde: string; hasta: string; dias: number };
  tramoAnterior: { desde: string; hasta: string; dias: number };
  ventas: { actual: number; anterior: number; variacion: string | null };
  recaudo: RecaudoMoneda[];
  sinSincronizar: { actual: number; anterior: number };
};

type FilaAgregada = { tramo: "actual" | "anterior"; moneda: string; ventas: number; sinFoto: number; recaudo: string };

// Arma el resultado a partir de las filas agregadas (tramo × moneda).
export function armarTablero(filas: FilaAgregada[], tramos: { actual: Tramo; anterior: Tramo }): TableroMes {
  const ventas = { actual: 0, anterior: 0 };
  const sinSincronizar = { actual: 0, anterior: 0 };
  const recaudoPorMoneda = new Map<string, { actual: bigint; anterior: bigint }>();
  for (const fila of filas) {
    ventas[fila.tramo] += fila.ventas;
    sinSincronizar[fila.tramo] += fila.sinFoto;
    const grupo = recaudoPorMoneda.get(fila.moneda) ?? { actual: CERO, anterior: CERO };
    grupo[fila.tramo] += aCentavos(fila.recaudo);
    recaudoPorMoneda.set(fila.moneda, grupo);
  }
  const anteriorCompleto = sinSincronizar.anterior === 0;
  const recaudo = [...recaudoPorMoneda.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moneda, grupo]): RecaudoMoneda => {
      const actual = desdeCentavos(grupo.actual);
      const anterior = desdeCentavos(grupo.anterior);
      const promedioActual = promedioDiario(actual, tramos.actual.dias);
      const promedioAnterior = promedioDiario(anterior, tramos.anterior.dias);
      return {
        moneda,
        actual,
        anterior,
        variacion: anteriorCompleto ? variacion(actual, anterior) : null,
        promedioActual,
        promedioAnterior,
        variacionPromedio: anteriorCompleto ? variacion(promedioActual, promedioAnterior) : null,
      };
    });
  const resumen = (t: Tramo) => ({ desde: t.desdeTexto, hasta: t.hastaTexto, dias: t.dias });
  return {
    tramo: resumen(tramos.actual),
    tramoAnterior: resumen(tramos.anterior),
    ventas: { ...ventas, variacion: variacion(String(ventas.actual), String(ventas.anterior)) },
    recaudo,
    sinSincronizar,
  };
}

// Una sola consulta agregada (tramo × moneda), sin importar cuántas
// cuentas de Mercado Libre tenga la empresa. Las sumas quedan en numeric
// y llegan como texto: nunca pasan por Number.
export async function leerTableroMes(empresaId: string, usuarioId: string, ahora: Date): Promise<TableroMes> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const tramos = tramosBogota(ahora);
  const { actual, anterior } = tramos;

  // El borde va como literal (sale de un Date, no del usuario) para que
  // la expresión del SELECT y la del GROUP BY sean idénticas; con un
  // parámetro distinto en cada una Postgres no las reconoce como la misma.
  const tramoSql = sql<"actual" | "anterior">`case when ${pedidos.fecha} >= ${sql.raw(`'${actual.inicio.toISOString()}'::timestamptz`)} then 'actual' else 'anterior' end`;

  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        tramo: tramoSql,
        moneda: pedidos.moneda,
        ventas: sql<number>`count(*)`.mapWith(Number),
        sinFoto: sql<number>`count(*) filter (where ${pedidosFinanzas.pedidoId} is null)`.mapWith(Number),
        recaudo: sql<string>`coalesce(sum(${pedidosFinanzas.valorVenta}), 0)::text`,
      })
      .from(pedidos)
      .leftJoin(
        pedidosFinanzas,
        and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id))
      )
      .where(
        and(
          eq(pedidos.empresaId, empresaId),
          or(
            and(gte(pedidos.fecha, actual.inicio), lt(pedidos.fecha, actual.finExclusivo)),
            and(gte(pedidos.fecha, anterior.inicio), lt(pedidos.fecha, anterior.finExclusivo))
          ),
          notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA),
          sql`coalesce(${pedidosFinanzas.cancelada}, false) = false`
        )
      )
      .groupBy(tramoSql, pedidos.moneda)
  );
  return armarTablero(filas, tramos);
}

// ---------------------------------------------------------------------------
// Utilidad del mes antes de publicidad (#143)
// ---------------------------------------------------------------------------

export type UtilidadMes = {
  // Ventas sincronizadas del tramo actual (detalle.total.ventas).
  ventas: number;
  ventasConCosto: number;
  ventasSinCosto: number;
  // null = "—": ninguna venta con costo, o ventas en varias monedas.
  utilidad: string | null;
  recaudoSinCosto: string;
  porcentajeVentasConCosto: string | null;
  // Ventas que el motor no pudo calcular.
  rechazadas: number;
  variasMonedas: boolean;
};

// El motor y el detalle no separan por moneda: con más de una, la
// utilidad no se suma (sería mezclar pesos con dólares). Sin costos no
// es 0 sino "—" (#143); sin ventas sí es "0.00".
export function resumirUtilidadMes(total: TotalesDetalle, rechazadas: number, monedas: string[]): UtilidadMes {
  const ventasConCosto = total.ventas - total.ventas_sin_costo;
  const variasMonedas = new Set(monedas).size > 1;
  const sinCostos = total.ventas > 0 && ventasConCosto === 0;
  return {
    ventas: total.ventas,
    ventasConCosto,
    ventasSinCosto: total.ventas_sin_costo,
    utilidad: variasMonedas || sinCostos ? null : total.utilidad,
    recaudoSinCosto: total.recaudo_sin_costo,
    porcentajeVentasConCosto: porcentajeVentasConCosto(total),
    rechazadas,
    variasMonedas,
  };
}

// Tramo actual de tramosBogota, todas las cuentas. `monedas` viene de
// leerTableroMes (recaudo por moneda), para no hacer otra consulta.
export async function leerUtilidadMes(empresaId: string, usuarioId: string, ahora: Date, monedas: string[]): Promise<UtilidadMes> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const { actual } = tramosBogota(ahora);
  const res = await listarVentasUtilidad(empresaId, usuarioId, { cuentaId: null, desde: actual.inicio, hastaExclusivo: actual.finExclusivo });
  return resumirUtilidadMes(res.detalle.total, res.rechazadas.length, monedas);
}

// ---------------------------------------------------------------------------
// Inicio: por cuenta y publicidad del mes (#143)
// ---------------------------------------------------------------------------

export const MONEDA_PUBLICIDAD = "COP";

export type MontoMoneda = { moneda: string; monto: string };

export type PublicidadCuenta = { cuentaMlId: string; nickname: string; monto: string; moneda: string };

export type PublicidadMes = {
  // null = ninguna fila de métricas de campaña en el tramo («Sin
  // datos», nunca 0).
  totalPorMoneda: MontoMoneda[] | null;
  // Mayor gasto primero.
  porCuenta: PublicidadCuenta[];
};

export type FilaCuentaTablero = {
  cuentaMlId: string;
  nickname: string;
  ventas: number;
  recaudoPorMoneda: MontoMoneda[];
  // null = sin filas de publicidad de esa cuenta en el tramo.
  publicidad: string | null;
};

export type FilaPublicidad = { cuentaMlId: string; nickname: string; costo: string };
export type FilaVentasCuenta = { cuentaMlId: string; nickname: string; moneda: string; ventas: number; recaudo: string };

function compararCentavos(a: bigint, b: bigint): number {
  return a === b ? 0 : a > b ? 1 : -1;
}

export function armarPublicidadMes(filas: FilaPublicidad[]): PublicidadMes {
  if (filas.length === 0) return { totalPorMoneda: null, porCuenta: [] };
  const total = filas.reduce((suma, f) => suma + aCentavos(f.costo), CERO);
  const porCuenta = filas
    .map((f) => ({ cuentaMlId: f.cuentaMlId, nickname: f.nickname, monto: desdeCentavos(aCentavos(f.costo)), moneda: MONEDA_PUBLICIDAD }))
    .sort((a, b) => compararCentavos(aCentavos(b.monto), aCentavos(a.monto)) || a.nickname.localeCompare(b.nickname));
  return { totalPorMoneda: [{ moneda: MONEDA_PUBLICIDAD, monto: desdeCentavos(total) }], porCuenta };
}

// Una fila por cuenta con ventas o con publicidad en el tramo. Orden:
// recaudo de mayor a menor (en centavos, sumando monedas solo para
// ordenar), luego nickname.
export function armarTableroPorCuenta(ventas: FilaVentasCuenta[], publicidad: PublicidadMes): FilaCuentaTablero[] {
  const porCuenta = new Map<string, { fila: FilaCuentaTablero; orden: bigint }>();
  const entrada = (cuentaMlId: string, nickname: string) => {
    let actual = porCuenta.get(cuentaMlId);
    if (!actual) {
      actual = { fila: { cuentaMlId, nickname, ventas: 0, recaudoPorMoneda: [], publicidad: null }, orden: CERO };
      porCuenta.set(cuentaMlId, actual);
    }
    return actual;
  };
  for (const v of ventas) {
    const e = entrada(v.cuentaMlId, v.nickname);
    e.fila.ventas += v.ventas;
    e.fila.recaudoPorMoneda.push({ moneda: v.moneda, monto: desdeCentavos(aCentavos(v.recaudo)) });
    e.orden += aCentavos(v.recaudo);
  }
  for (const p of publicidad.porCuenta) entrada(p.cuentaMlId, p.nickname).fila.publicidad = p.monto;
  return [...porCuenta.values()]
    .sort((a, b) => compararCentavos(b.orden, a.orden) || a.fila.nickname.localeCompare(b.fila.nickname))
    .map(({ fila }) => ({ ...fila, recaudoPorMoneda: [...fila.recaudoPorMoneda].sort((a, b) => a.moneda.localeCompare(b.moneda)) }));
}

// Participación de una cuenta en el total, con 1 decimal ("57.1").
export function participacion(parte: number, total: number): string {
  if (total <= 0) return "0.0";
  const decimas = dividirRedondeando(BigInt(parte) * MIL, BigInt(total));
  return `${decimas / DIEZ}.${decimas % DIEZ}`;
}

// Postgres «undefined_table» / «undefined_object»: la migración de
// publicidad (0011) todavía no está en ese entorno.
function esObjetoInexistente(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    const codigo = (e as { code?: unknown }).code;
    if (codigo === "42P01" || codigo === "42704") return true;
  }
  return false;
}

export async function leerPublicidadMes(empresaId: string, usuarioId: string, ahora: Date): Promise<PublicidadMes> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const { actual } = tramosBogota(ahora);
  try {
    // En su propia transacción: si la tabla no existe, el error no
    // aborta ninguna otra lectura.
    const filas = await dbComoEmpresa(empresaId, (tx) =>
      tx
        .select({
          cuentaMlId: publicidadMetricasDiarias.cuentaMlId,
          nickname: cuentasMl.nickname,
          costo: sql<string>`coalesce(sum(${publicidadMetricasDiarias.costo}), 0)::text`,
        })
        .from(publicidadMetricasDiarias)
        .innerJoin(cuentasMl, and(eq(cuentasMl.id, publicidadMetricasDiarias.cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
        .where(
          and(
            eq(publicidadMetricasDiarias.empresaId, empresaId),
            eq(publicidadMetricasDiarias.nivel, "campana"),
            gte(publicidadMetricasDiarias.fecha, actual.desdeTexto),
            lte(publicidadMetricasDiarias.fecha, actual.hastaTexto)
          )
        )
        .groupBy(publicidadMetricasDiarias.cuentaMlId, cuentasMl.nickname)
    );
    return armarPublicidadMes(filas);
  } catch (error) {
    if (esObjetoInexistente(error)) return { totalPorMoneda: null, porCuenta: [] };
    throw error;
  }
}

// Ventas (cantidad, de pedidos) y recaudo (valor_venta) por cuenta del
// tramo actual, con el mismo criterio de venta que leerTableroMes. Una
// sola consulta, sin importar cuántas cuentas haya. `publicidad` se pasa
// si ya se leyó (Inicio), para no consultarla dos veces.
export async function leerTableroPorCuenta(
  empresaId: string,
  usuarioId: string,
  ahora: Date,
  publicidad?: PublicidadMes
): Promise<FilaCuentaTablero[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  const { actual } = tramosBogota(ahora);
  const ventas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        cuentaMlId: pedidos.cuentaMlId,
        nickname: cuentasMl.nickname,
        moneda: pedidos.moneda,
        ventas: sql<number>`count(*)`.mapWith(Number),
        recaudo: sql<string>`coalesce(sum(${pedidosFinanzas.valorVenta}), 0)::text`,
      })
      .from(pedidos)
      .innerJoin(cuentasMl, and(eq(cuentasMl.id, pedidos.cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
      .leftJoin(
        pedidosFinanzas,
        and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.empresaId, pedidos.empresaId), eq(pedidosFinanzas.pedidoId, pedidos.id))
      )
      .where(
        and(
          eq(pedidos.empresaId, empresaId),
          gte(pedidos.fecha, actual.inicio),
          lt(pedidos.fecha, actual.finExclusivo),
          notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA),
          sql`coalesce(${pedidosFinanzas.cancelada}, false) = false`
        )
      )
      .groupBy(pedidos.cuentaMlId, cuentasMl.nickname, pedidos.moneda)
  );
  return armarTableroPorCuenta(ventas, publicidad ?? (await leerPublicidadMes(empresaId, usuarioId, ahora)));
}

// ---------------------------------------------------------------------------
// Textos de pantalla
// ---------------------------------------------------------------------------

const VS = "vs. mismo tramo mes anterior";

// "10.4" → "▲ 10,4 % vs. …"; null → "— vs. …" (anterior en 0) o
// "— (mes anterior sin sincronizar)" cuando no se compara a propósito.
export function textoVariacion(valor: string | null, anteriorSinSincronizar = false): string {
  if (anteriorSinSincronizar) return "— (mes anterior sin sincronizar)";
  if (valor === null) return `— ${VS}`;
  const negativo = valor.startsWith("-");
  const absoluto = (negativo ? valor.slice(1) : valor).replace(".", ",");
  const flecha = negativo ? "▼" : /^0[.,]0$/.test(absoluto) ? "=" : "▲";
  return `${flecha} ${absoluto} % ${VS}`;
}
