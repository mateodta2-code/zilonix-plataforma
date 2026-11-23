import { validarMonto } from "./montos";
import { aDiezmilesimas, aTextoMonto } from "./por-cobrar";

// Issue #422 (fase 4 de Finanzas) — gastos externos: lógica pura (sin
// base de datos), para poder probarla sin Postgres. Montos en texto y
// BigInt, nunca Number, igual que el resto de Finanzas. Los totales se
// agrupan por moneda: nunca se suman pesos con pesos mexicanos.

export const ESTADOS_GASTO = ["pendiente", "pagado"] as const;
export type EstadoGasto = (typeof ESTADOS_GASTO)[number];

export const ETIQUETA_ESTADO_GASTO: Record<EstadoGasto, string> = {
  pendiente: "Pendiente",
  pagado: "Pagado",
};

export class GastoInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "GastoInvalidoError";
  }
}

const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// "2026-02-30" pasa el patrón pero no es un día real: se compara contra
// lo que devuelve Date en UTC.
export function esFechaValida(texto: string): boolean {
  if (!PATRON_FECHA.test(texto)) return false;
  const d = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === texto;
}

export function esUuid(texto: string | null | undefined): texto is string {
  return typeof texto === "string" && PATRON_UUID.test(texto);
}

// ---------- Tienda (cuenta ML o Falabella) ----------

// En el formulario y en la URL la tienda viaja como "ml:<uuid>" o
// "falabella:<uuid>"; vacío = toda la empresa.
export type Tienda = { marketplace: "ml" | "falabella"; cuentaId: string };

export function leerTienda(valor: unknown): Tienda | null {
  if (typeof valor !== "string") return null;
  const m = /^(ml|falabella):(.+)$/.exec(valor);
  if (!m || !esUuid(m[2])) return null;
  return { marketplace: m[1] as Tienda["marketplace"], cuentaId: m[2].toLowerCase() };
}

export function claveTienda(t: { cuentaMlId: string | null; cuentaFalabellaId: string | null }): string {
  if (t.cuentaMlId) return `ml:${t.cuentaMlId}`;
  if (t.cuentaFalabellaId) return `falabella:${t.cuentaFalabellaId}`;
  return "";
}

// ---------- Validación del formulario ----------

export type EntradaGasto = {
  tienda: string;
  categoriaId: string;
  terceroId: string;
  beneficiario: string;
  descripcion: string;
  monto: string;
  fechaGasto: string;
  fechaVencimiento: string;
  pagado: boolean;
  fechaPago: string;
  medioPago: string;
  soporte: string;
};

export type GastoValidado = {
  tienda: Tienda | null;
  categoriaId: string;
  terceroId: string | null;
  beneficiario: string | null;
  descripcion: string;
  monto: string;
  fechaGasto: string;
  fechaVencimiento: string | null;
  estado: EstadoGasto;
  fechaPago: string | null;
  medioPago: string | null;
  soporte: string | null;
};

const vacioANull = (texto: string): string | null => {
  const t = texto.trim();
  return t === "" ? null : t;
};

// Mismas reglas que los CHECK de db/schema.ts (gastos), con un mensaje
// legible antes de que Postgres lo rechace.
export function validarGasto(e: EntradaGasto): GastoValidado {
  const tiendaTexto = e.tienda.trim();
  const tienda = tiendaTexto === "" ? null : leerTienda(tiendaTexto);
  if (tiendaTexto !== "" && !tienda) throw new GastoInvalidoError("La tienda elegida no es válida.");

  if (!esUuid(e.categoriaId.trim())) throw new GastoInvalidoError("Elige la categoría del gasto.");

  const terceroTexto = e.terceroId.trim();
  if (terceroTexto !== "" && !esUuid(terceroTexto)) throw new GastoInvalidoError("El proveedor elegido no es válido.");
  const beneficiario = vacioANull(e.beneficiario);
  if (beneficiario && beneficiario.length > 120) throw new GastoInvalidoError("El beneficiario puede tener hasta 120 caracteres.");
  if (terceroTexto === "" && !beneficiario) throw new GastoInvalidoError("Elige un proveedor o escribe a quién se le paga.");

  const descripcion = e.descripcion.trim();
  if (!descripcion) throw new GastoInvalidoError("La descripción es obligatoria.");
  if (descripcion.length > 300) throw new GastoInvalidoError("La descripción puede tener hasta 300 caracteres.");

  const monto = validarMonto(e.monto, "Monto del gasto");
  if (monto === null || aDiezmilesimas(monto) <= BigInt(0)) throw new GastoInvalidoError("El monto tiene que ser mayor que 0.");

  if (!esFechaValida(e.fechaGasto.trim())) throw new GastoInvalidoError("La fecha del gasto no es válida.");
  const fechaVencimiento = vacioANull(e.fechaVencimiento);
  if (fechaVencimiento && !esFechaValida(fechaVencimiento)) throw new GastoInvalidoError("La fecha de vencimiento no es válida.");

  let fechaPago: string | null = null;
  if (e.pagado) {
    fechaPago = vacioANull(e.fechaPago);
    if (!fechaPago || !esFechaValida(fechaPago)) throw new GastoInvalidoError("Un gasto pagado necesita una fecha de pago válida.");
  }

  const medioPago = vacioANull(e.medioPago);
  if (medioPago && medioPago.length > 60) throw new GastoInvalidoError("El medio de pago puede tener hasta 60 caracteres.");
  const soporte = vacioANull(e.soporte);
  if (soporte && soporte.length > 300) throw new GastoInvalidoError("El soporte puede tener hasta 300 caracteres.");

  return {
    tienda,
    categoriaId: e.categoriaId.trim().toLowerCase(),
    terceroId: terceroTexto === "" ? null : terceroTexto.toLowerCase(),
    beneficiario,
    descripcion,
    monto,
    fechaGasto: e.fechaGasto.trim(),
    fechaVencimiento,
    estado: e.pagado ? "pagado" : "pendiente",
    fechaPago,
    medioPago,
    soporte,
  };
}

export function validarPago(fechaPago: string, medioPago: string): { fechaPago: string; medioPago: string | null } {
  const fecha = fechaPago.trim();
  if (!esFechaValida(fecha)) throw new GastoInvalidoError("La fecha de pago no es válida.");
  const medio = vacioANull(medioPago);
  if (medio && medio.length > 60) throw new GastoInvalidoError("El medio de pago puede tener hasta 60 caracteres.");
  return { fechaPago: fecha, medioPago: medio };
}

// ---------- Fechas (mes de Bogotá) ----------

export type Periodo = { desde: string; hasta: string };

// Último día del mes de "AAAA-MM".
function finDeMes(mes: string): string {
  const [a, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

export function mesDeDia(dia: string): Periodo {
  const mes = dia.slice(0, 7);
  return { desde: `${mes}-01`, hasta: finDeMes(mes) };
}

// ---------- Filtros de la URL ----------

export type FiltrosGastos = {
  desde: string;
  hasta: string;
  tienda: string | null; // "ml:<uuid>" | "falabella:<uuid>" | "empresa"
  categoriaId: string | null;
  estado: EstadoGasto | "vencido" | null;
};

// Lista blanca: lo que no se reconoce se ignora, nunca llega a la
// consulta. Sin fechas (o fechas inválidas) se ve el mes en curso.
export function leerFiltrosGastos(params: Record<string, string | string[] | undefined>, hoy: string): FiltrosGastos {
  const uno = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim() : "");
  const mes = mesDeDia(hoy);
  let desde = esFechaValida(uno(params.desde)) ? uno(params.desde) : mes.desde;
  let hasta = esFechaValida(uno(params.hasta)) ? uno(params.hasta) : mes.hasta;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const tiendaTexto = uno(params.tienda);
  const tienda = tiendaTexto === "empresa" ? "empresa" : leerTienda(tiendaTexto) ? tiendaTexto.toLowerCase() : null;
  const categoria = uno(params.categoria);
  const estadoTexto = uno(params.estado);
  const estado = estadoTexto === "vencido" ? "vencido" : (ESTADOS_GASTO.find((e) => e === estadoTexto) ?? null);
  return { desde, hasta, tienda, categoriaId: esUuid(categoria) ? categoria.toLowerCase() : null, estado };
}

// ---------- Estado y totales ----------

export type GastoResumen = {
  cuentaMlId: string | null;
  cuentaFalabellaId: string | null;
  categoriaId: string;
  monto: string;
  moneda: string;
  fechaGasto: string;
  fechaVencimiento: string | null;
  estado: EstadoGasto;
};

// Vencido = sigue pendiente y su vencimiento ya pasó (día de Bogotá).
// Un gasto sin fecha de vencimiento nunca está vencido.
export function estaVencido(g: Pick<GastoResumen, "estado" | "fechaVencimiento">, hoy: string): boolean {
  return g.estado === "pendiente" && g.fechaVencimiento !== null && g.fechaVencimiento < hoy;
}

// Filtros de tienda y categoría (los de las tarjetas: no dependen del
// rango de fechas ni del estado).
export function filtrarPorTiendaYCategoria<T extends GastoResumen>(gastos: T[], f: Pick<FiltrosGastos, "tienda" | "categoriaId">): T[] {
  return gastos.filter((g) => {
    if (f.categoriaId && g.categoriaId !== f.categoriaId) return false;
    if (f.tienda === "empresa") return !g.cuentaMlId && !g.cuentaFalabellaId;
    if (f.tienda) return claveTienda(g) === f.tienda;
    return true;
  });
}

export function filtrarGastos<T extends GastoResumen>(gastos: T[], f: FiltrosGastos, hoy: string): T[] {
  return filtrarPorTiendaYCategoria(gastos, f).filter((g) => {
    if (g.fechaGasto < f.desde || g.fechaGasto > f.hasta) return false;
    if (f.estado === "vencido") return estaVencido(g, hoy);
    if (f.estado) return g.estado === f.estado;
    return true;
  });
}

export type TotalesGastoMoneda = { moneda: string; totalMes: string; pendiente: string; vencido: string };

// Tarjetas: total del mes en curso (pagado o no), todo lo pendiente
// (de cualquier fecha) y, dentro de eso, lo vencido. Una fila por moneda.
export function resumirGastos(gastos: GastoResumen[], hoy: string): TotalesGastoMoneda[] {
  const mes = mesDeDia(hoy);
  const cero = BigInt(0);
  const porMoneda = new Map<string, { totalMes: bigint; pendiente: bigint; vencido: bigint }>();
  for (const g of gastos) {
    const t = porMoneda.get(g.moneda) ?? { totalMes: cero, pendiente: cero, vencido: cero };
    const monto = aDiezmilesimas(g.monto);
    if (g.fechaGasto >= mes.desde && g.fechaGasto <= mes.hasta) t.totalMes += monto;
    if (g.estado === "pendiente") t.pendiente += monto;
    if (estaVencido(g, hoy)) t.vencido += monto;
    porMoneda.set(g.moneda, t);
  }
  return [...porMoneda.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([moneda, t]) => ({ moneda, totalMes: aTextoMonto(t.totalMes), pendiente: aTextoMonto(t.pendiente), vencido: aTextoMonto(t.vencido) }));
}

// Lo que va a la bitácora: datos del gasto, no secretos.
export function textoAuditoriaGasto(g: Pick<GastoValidado, "descripcion" | "monto" | "fechaGasto" | "estado" | "fechaPago">, moneda: string): string {
  const pago = g.estado === "pagado" ? `, pagado el ${g.fechaPago}` : ", pendiente";
  return `«${g.descripcion}» por ${g.monto} ${moneda} del ${g.fechaGasto}${pago}`;
}
