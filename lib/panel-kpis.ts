import { and, asc, eq, gte, lt, notInArray, sql, sum } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, pedidos } from "@/db/schema";
import { rangoDiaBogota } from "@/lib/filtros-listado";
import { contarDespachosPendientes } from "@/lib/ml/despachos";
import { contarPublicacionesSinSku as contarSkuSinVincular } from "@/lib/ml/sku";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";

// Tarea de KPIs reales — cada tarjeta de app/panel/page.tsx calcula su
// valor con las tablas que ya existen, siempre con dbComoEmpresa() (el
// mismo cliente con RLS que usa cualquier otra pantalla del panel,
// nunca el rol trabajador) y siempre con empresaId fijo en el WHERE
// además de la política de RLS (mismo criterio defensivo de
// lib/ml/sku.ts y lib/ml/despachos.ts). Ningún KPI inventa un número:
// sin filas, el resultado es 0 o una lista vacía, nunca un valor de
// ejemplo. El null aparece solo cuando el rol no puede consultar el
// módulo (obtenerKpisPanel), que es distinto de "este mes no hubo
// ventas".

// America/Bogota no observa horario de verano: es UTC-5 todo el año.
// Railway corre en UTC, así que `new Date(año, mes, 1)` usaría la zona
// del proceso y abriría el mes cinco horas antes de la medianoche en
// Colombia. El reloj de Bogotá se lee restando ese offset y usando
// getters UTC, para no depender de la zona configurada en el servidor.
const OFFSET_BOGOTA_MS = 5 * 60 * 60 * 1000;

export function rangoMesActual(ahora: Date = new Date()): { inicio: Date; finExclusivo: Date } {
  const relojBogota = new Date(ahora.getTime() - OFFSET_BOGOTA_MS);
  const anio = relojBogota.getUTCFullYear();
  const mes = relojBogota.getUTCMonth();
  // 00:00 del día 1 en Bogotá = 05:00 UTC. El fin es exclusivo: el
  // mismo instante del día 1 del mes siguiente. Un pedido de las
  // 20:00 del último día (01:00 UTC del día 1 siguiente) sigue
  // adentro; uno de las 00:00 del día 1, no.
  return {
    inicio: new Date(Date.UTC(anio, mes, 1, 5, 0, 0, 0)),
    finExclusivo: new Date(Date.UTC(anio, mes + 1, 1, 5, 0, 0, 0)),
  };
}

// Estados de Mercado Libre que NO son una venta: todo lo demás —
// paid, confirmed, payment_required, payment_in_process — cuenta. La
// misma lista para "Ventas de hoy" (#153) y "Ventas del mes" (#160),
// para que las dos tarjetas cuadren: un pedido cancelado hoy no puede
// faltar en una y sumar en la otra. Lista fija del código, nunca un
// valor de la petición. "Pedidos" (contarPedidos) no la usa: cuenta
// pedidos, no ventas.
const ESTADOS_QUE_NO_SON_VENTA = ["cancelled", "invalid"];

export type TotalPorMoneda = { moneda: string; total: string };

// "Ventas del mes" — sum(pedidos.total) en Postgres, agrupado por
// moneda, sin sumar los pedidos cancelled ni invalid
// (ESTADOS_QUE_NO_SON_VENTA). numeric llega como string (drizzle
// sum() hace mapWith(String), no Number): sumar montos en JS con float pierde centavos en cuanto
// el agregado pasa el entero seguro, y además no se pueden comparar
// ni mezclar monedas distintas. Se devuelven TODOS los grupos, en
// orden del código de moneda (texto, no monto).
export async function calcularVentasDelMes(empresaId: string, ahora: Date = new Date()): Promise<TotalPorMoneda[]> {
  const { inicio, finExclusivo } = rangoMesActual(ahora);
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ moneda: pedidos.moneda, total: sum(pedidos.total) })
      .from(pedidos)
      .where(
        and(
          eq(pedidos.empresaId, empresaId),
          gte(pedidos.fecha, inicio),
          lt(pedidos.fecha, finExclusivo),
          notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA)
        )
      )
      .groupBy(pedidos.moneda)
      .orderBy(asc(pedidos.moneda))
  );
  return filas.flatMap((fila) => (fila.total == null ? [] : [{ moneda: fila.moneda, total: fila.total }]));
}

export type VentasPorCuenta = { nickname: string; cantidad: number };

export type VentasDeHoy = {
  cantidad: number;
  montos: TotalPorMoneda[];
  porCuenta: VentasPorCuenta[];
};

// "Ventas de hoy" — día de Bogotá de `ahora` (rangoDiaBogota), todas
// las cuentas de Mercado Libre de la empresa. count(*) y sum() en
// Postgres, mismo criterio que calcularVentasDelMes: el monto queda en
// string, por moneda. El desglose por cuenta usa el mismo filtro que
// el total, así que siempre suma la cifra grande (la prueba lo exige).
export async function calcularVentasDeHoy(empresaId: string, ahora: Date = new Date()): Promise<VentasDeHoy> {
  const { inicio, finExclusivo } = rangoDiaBogota(ahora);
  const filtro = and(
    eq(pedidos.empresaId, empresaId),
    gte(pedidos.fecha, inicio),
    lt(pedidos.fecha, finExclusivo),
    notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA)
  );
  const { total, montos, cuentas } = await dbComoEmpresa(empresaId, async (tx) => {
    const [total] = await tx
      .select({ cantidad: sql<number>`count(*)`.mapWith(Number) })
      .from(pedidos)
      .where(filtro);
    const montos = await tx
      .select({ moneda: pedidos.moneda, total: sum(pedidos.total) })
      .from(pedidos)
      .where(filtro)
      .groupBy(pedidos.moneda)
      .orderBy(asc(pedidos.moneda));
    const cuentas = await tx
      .select({ nickname: cuentasMl.nickname, cantidad: sql<number>`count(*)`.mapWith(Number) })
      .from(pedidos)
      .innerJoin(cuentasMl, and(eq(cuentasMl.id, pedidos.cuentaMlId), eq(cuentasMl.empresaId, empresaId)))
      .where(filtro)
      .groupBy(cuentasMl.id, cuentasMl.nickname)
      .orderBy(asc(cuentasMl.nickname));
    return { total, montos, cuentas };
  });
  return {
    cantidad: total.cantidad,
    montos: montos.flatMap((fila) => (fila.total == null ? [] : [{ moneda: fila.moneda, total: fila.total }])),
    porCuenta: cuentas,
  };
}

// package.json no declara "engines". El CI fija Node 20
// (.github/workflows/ci.yml) y NumberFormat v3, desde Node 20, acepta
// el string decimal en format() (ToIntlMathematicalValue) sin pasarlo
// por Number(). En un Node anterior se arma el mismo texto a mano.
const NODO_FORMATEA_MONTO_STRING = Number(process.versions.node.split(".")[0]) >= 20;
const formatoMontoEsCo = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

function esMontoDecimal(monto: string): monto is Intl.StringNumericLiteral {
  return /^-?\d+(\.\d+)?$/.test(monto);
}

function sumarUno(entera: string): string {
  const digitos = [...entera];
  let acarreo = 1;
  for (let i = digitos.length - 1; i >= 0 && acarreo; i--) {
    const n = digitos[i].charCodeAt(0) - 48 + acarreo;
    if (n >= 10) {
      digitos[i] = "0";
      acarreo = 1;
    } else {
      digitos[i] = String(n);
      acarreo = 0;
    }
  }
  if (acarreo) digitos.unshift("1");
  return digitos.join("");
}

// Mismo criterio que Intl es-CO con maximumFractionDigits: 2 y el
// redondeo halfExpand (empate, lejos de cero): miles con punto, decimal
// con coma, sin ceros de más. No usa Number(): un numeric(14,2) sumado
// muchas veces se sale del entero seguro.
function formatearMontoPorTexto(monto: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(monto);
  if (!match) return monto;
  const negativo = match[1] === "-";
  let entera = match[2].replace(/^0+(?=\d)/, "");
  const frac = match[3] ?? "";
  let d0 = frac.charCodeAt(0) - 48;
  let d1 = frac.charCodeAt(1) - 48;
  if (!Number.isFinite(d0) || d0 < 0) d0 = 0;
  if (!Number.isFinite(d1) || d1 < 0) d1 = 0;
  const siguiente = frac.charCodeAt(2) - 48;
  if (Number.isFinite(siguiente) && siguiente >= 5) {
    d1 += 1;
    if (d1 >= 10) {
      d1 = 0;
      d0 += 1;
    }
    if (d0 >= 10) {
      d0 = 0;
      d1 = 0;
      entera = sumarUno(entera);
    }
  }
  const conMiles = entera.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const fracVisible = `${d0}${d1}`.replace(/0+$/, "");
  const cuerpo = fracVisible ? `${conMiles},${fracVisible}` : conMiles;
  // Intl es-CO deja el signo en el cero negativo ("-0"): -0.001 con
  // máximo 2 decimales no sube a -0,01, pero tampoco pierde el menos.
  if (negativo) return cuerpo === "0" ? "-0" : `-${cuerpo}`;
  return cuerpo;
}

// Exportada para la tabla de pedidos: el numeric de Postgres llega
// como string y no puede pasar por Number() (un monto por encima del
// entero seguro pierde centavos). Mismo formateador que las ventas
// del mes, para que "COP 150.000" se vea igual en las dos pantallas.
export function formatearMonto(monto: string): string {
  if (NODO_FORMATEA_MONTO_STRING && esMontoDecimal(monto)) {
    return formatoMontoEsCo.format(monto);
  }
  return formatearMontoPorTexto(monto);
}

// Sin filas en el mes no hay moneda que mostrar: la tarjeta dice
// "COP 0" (la misma forma que una venta real, no "Pendiente de
// conectar" ni un 0 pelado). Con filas, cada grupo va aparte —
// "COP 1.234.000 · USD 50" — y nunca se elige uno por ser más grande.
export function formatearVentasDelMes(grupos: TotalPorMoneda[]): string {
  if (grupos.length === 0) return "COP 0";
  return grupos.map((grupo) => `${grupo.moneda} ${formatearMonto(grupo.total)}`).join(" · ");
}

// Las líneas pequeñas de "Ventas de hoy": el monto por moneda (mismo
// texto que Ventas del mes, "COP 0" sin ventas) y, solo si vendió más
// de una cuenta hoy, "APODO: cantidad" por cuenta — con una sola
// cuenta ese desglose repetiría la cifra grande.
export function detalleVentasDeHoy(ventas: VentasDeHoy): string[] {
  const lineas = [formatearVentasDelMes(ventas.montos)];
  if (ventas.porCuenta.length > 1) {
    lineas.push(ventas.porCuenta.map((cuenta) => `${cuenta.nickname}: ${cuenta.cantidad}`).join(" · "));
  }
  return lineas;
}

// "Pedidos" — conteo total de pedidos importados (todo el histórico, a
// diferencia de "Ventas del mes" que sí se acota al mes de calendario).
export async function contarPedidos(empresaId: string): Promise<number> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(pedidos)
      .where(eq(pedidos.empresaId, empresaId))
  );
  return fila.total;
}

// "Despachos pendientes" y "SKU sin vincular" — count(*) real
// (lib/ml/despachos.ts, lib/ml/sku.ts), EXACTAMENTE con el mismo WHERE
// que sus propias pantallas de listado, así que nunca se desalinean
// con lo que esas pantallas muestran. Antes traían la lista completa
// solo para medir su .length; contarDespachosPendientes/
// contarSkuSinVincular quedan re-exportadas acá con el mismo nombre de
// siempre para no tocar a quien ya las importaba de este archivo.
export { contarDespachosPendientes, contarSkuSinVincular };

// Misma pregunta que el resto de las rutas de negocio
// (requierePermiso), no un tienePermiso suelto sobre la lista que ya
// cargó el layout. SinPermisoError es "este rol no ve el KPI" (null);
// cualquier otro error (base caída, id inválido) se propaga — si se
// tragara, la página pintaría ceros como si la persona no tuviera
// permiso.
async function puedeConsultar(usuarioId: string, empresaId: string, modulo: "ventas" | "inventario"): Promise<boolean> {
  try {
    await requierePermiso(usuarioId, empresaId, modulo, "consultar");
    return true;
  } catch (error) {
    if (error instanceof SinPermisoError) return false;
    throw error;
  }
}

export type KpisPanel = {
  ventasDeHoy: VentasDeHoy | null;
  ventasDelMes: TotalPorMoneda[] | null;
  pedidos: number | null;
  despachosPendientes: number | null;
  skuSinVincular: number | null;
};

// ventas de hoy, ventas del mes, pedidos y despachos piden
// "ventas"+"consultar". SKU sin vincular pide "inventario"+"consultar".
// null = el rol no puede ver esa cifra (la tarjeta no se pinta). Una lista vacía o un 0 = sí
// puede, y este mes / esta empresa todavía no tiene filas.
export async function obtenerKpisPanel(usuarioId: string, empresaId: string, ahora: Date = new Date()): Promise<KpisPanel> {
  const [veVentas, veInventario] = await Promise.all([
    puedeConsultar(usuarioId, empresaId, "ventas"),
    puedeConsultar(usuarioId, empresaId, "inventario"),
  ]);
  const [ventasDeHoy, ventasDelMes, pedidosTotal, despachosPendientes, skuSinVincular] = await Promise.all([
    veVentas ? calcularVentasDeHoy(empresaId, ahora) : Promise.resolve(null),
    veVentas ? calcularVentasDelMes(empresaId, ahora) : Promise.resolve(null),
    veVentas ? contarPedidos(empresaId) : Promise.resolve(null),
    veVentas ? contarDespachosPendientes(empresaId) : Promise.resolve(null),
    veInventario ? contarSkuSinVincular(empresaId) : Promise.resolve(null),
  ]);
  return { ventasDeHoy, ventasDelMes, pedidos: pedidosTotal, despachosPendientes, skuSinVincular };
}
