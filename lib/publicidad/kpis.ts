// Issue #255 — cuentas del tablero de Product Ads. Puras: no leen la
// base ni el reloj salvo que quien llama pase `ahora`. La plata entra
// y sale como texto decimal, igual que el numeric de Postgres, y se
// suma en centavos con BigInt. Un ratio (ROAS, ACOS, TACOS, CPC) se
// recalcula desde las sumas del rango: promediar el ratio de cada día
// no es el ratio del rango.
//
// Cualquier división con denominador 0 o null devuelve null. La
// pantalla pinta "—". Nunca un 0 inventado ni Infinity ni NaN.
// Si todos los días de un sumando son null, el total es null, no 0.

import { aCentavos, desdeCentavos } from "@/lib/finanzas/utilidad-venta";
import { aEscala } from "@/lib/numeros/normalizar-decimal";
import { diasEntreInclusive, hoyBogota } from "@/lib/publicidad/plan";
import { ACOS_MAXIMO, FACTOR_EXCELENTE, TOPE_GASTO_SIN_VENTAS, type ConfigPublicidad } from "@/lib/publicidad/config";

const CERO = BigInt(0);
const DOS = BigInt(2);
const ESCALA = 4;
const FACTOR_ESCALA = BigInt(10) ** BigInt(ESCALA);

export type DiaMetrica = {
  costo: string | null;
  montoTotal: string | null;
  ventasOrganicasMonto: string | null;
  clicks: number | string | null;
  impresiones: number | string | null;
};

export type TotalesRango = {
  gasto: string | null;
  ventasPublicidad: string | null;
  ventasOrganicas: string | null;
  ventasTotales: string | null;
  clicks: string | null;
  impresiones: string | null;
  cpc: string | null;
  roas: string | null;
  acos: string | null;
  tacos: string | null;
};

export type TipoDiagnostico = "aprendiendo" | "excelente" | "en_objetivo" | "bajo_objetivo" | "sin_objetivo" | "sin_datos";

export type Diagnostico = {
  tipo: TipoDiagnostico;
  dias: number;
};

export type Semaforo =
  | { estado: "exito" | "peligro"; motivo: "acos"; acos: string; tope: string }
  | { estado: "exito" | "peligro"; motivo: "gasto"; gasto: string; topeGasto: string; precio: string; tope: string }
  | { estado: "neutro"; motivo: "sin_gasto" | "sin_precio" };

export type Periodo = {
  mes: string;
  desde: string;
  hasta: string;
  comparacionDesde: string;
  comparacionHasta: string;
  incluyeHoy: boolean;
  esMesEnCurso: boolean;
};

export const COLUMNAS_ORDEN = [
  "campana",
  "inversion",
  "ventas_publicidad",
  "ventas_totales",
  "roas",
  "acos",
  "tacos",
  "cpc",
  "clics",
  "impresiones",
  "presupuesto",
] as const;

export type ColumnaOrden = (typeof COLUMNAS_ORDEN)[number];
export type DireccionOrden = "asc" | "desc";

function unidades(decimal: string, escala: number): bigint {
  const escalado = aEscala(decimal, escala);
  const negativo = escalado.startsWith("-");
  const [entero, fraccion = ""] = (negativo ? escalado.slice(1) : escalado).split(".");
  const valor = BigInt(entero) * BigInt(10) ** BigInt(escala) + BigInt(fraccion.padEnd(escala, "0") || "0");
  return negativo ? -valor : valor;
}

function centavos(monto: string): bigint {
  return aCentavos(aEscala(monto, 2));
}

function textoRazon(escalado: bigint, decimales: number, negativo: boolean): string {
  const texto = escalado.toString().padStart(decimales + 1, "0");
  const entera = texto.slice(0, texto.length - decimales);
  const frac = texto.slice(texto.length - decimales);
  const cuerpo = decimales === 0 ? entera : `${entera}.${frac}`;
  return negativo && escalado !== CERO ? `-${cuerpo}` : cuerpo;
}

// Redondeo mitad lejos de cero. `decimales` es la escala del resultado.
function dividir(numerador: bigint, denominador: bigint, decimales: number): string | null {
  if (denominador === CERO) return null;
  const negativo = (numerador < CERO) !== (denominador < CERO);
  const n = numerador < CERO ? -numerador : numerador;
  const d = denominador < CERO ? -denominador : denominador;
  const factor = BigInt(10) ** BigInt(decimales);
  const escalado = (n * factor * DOS + d) / (d * DOS);
  return textoRazon(escalado, decimales, negativo);
}

// n/d <= tope, con tope en texto decimal ("0.20"). null si no se puede.
function razonNoSupera(numerador: string, denominador: string, tope: string): boolean | null {
  const d = unidades(denominador, ESCALA);
  if (d === CERO) return null;
  const n = unidades(numerador, ESCALA);
  const t = unidades(tope, ESCALA);
  const izquierda = n * FACTOR_ESCALA;
  const derecha = d * t;
  return izquierda <= derecha;
}

// ventas/gasto >= objetivo * factor. Los tres textos son decimales.
function roasAlcanza(ventas: string, gasto: string, objetivo: string, factor: string): boolean | null {
  const g = unidades(gasto, ESCALA);
  if (g === CERO) return null;
  const v = unidades(ventas, ESCALA);
  const o = unidades(objetivo, ESCALA);
  const f = unidades(factor, ESCALA);
  if (o <= CERO) return null;
  return v * FACTOR_ESCALA * FACTOR_ESCALA >= g * o * f;
}

export function sumarMontos(valores: readonly (string | null | undefined)[]): string | null {
  let total = CERO;
  let alguno = false;
  for (const valor of valores) {
    if (valor === null || valor === undefined || valor.trim() === "") continue;
    total += centavos(valor);
    alguno = true;
  }
  return alguno ? desdeCentavos(total) : null;
}

export function sumarEnteros(valores: readonly (number | string | null | undefined)[]): string | null {
  let total = CERO;
  let alguno = false;
  for (const valor of valores) {
    if (valor === null || valor === undefined || valor === "") continue;
    const texto = String(valor).trim();
    if (!/^-?\d+$/.test(texto)) {
      if (/^-?\d+\.0+$/.test(texto)) {
        total += BigInt(texto.split(".")[0]);
        alguno = true;
        continue;
      }
      throw new Error("entero inválido");
    }
    total += BigInt(texto);
    alguno = true;
  }
  return alguno ? total.toString() : null;
}

function dividirMonto(gasto: string | null, clicks: string | null): string | null {
  if (gasto === null || clicks === null) return null;
  const c = BigInt(clicks);
  if (c === CERO) return null;
  const redondeado = dividir(centavos(gasto), c, 0);
  if (redondeado === null) return null;
  return desdeCentavos(BigInt(redondeado));
}

function dividirRazon(numerador: string | null, denominador: string | null, decimales: number): string | null {
  if (numerador === null || denominador === null) return null;
  return dividir(centavos(numerador), centavos(denominador), decimales);
}

export function totalesDeDias(dias: readonly DiaMetrica[]): TotalesRango {
  const gasto = sumarMontos(dias.map((d) => d.costo));
  const ventasPublicidad = sumarMontos(dias.map((d) => d.montoTotal));
  const ventasOrganicas = sumarMontos(dias.map((d) => d.ventasOrganicasMonto));
  // Si una de las dos patas no vino en ningún día, no se inventa un 0
  // para poder mostrar un total.
  const ventasTotales =
    ventasPublicidad !== null && ventasOrganicas !== null ? sumarMontos([ventasPublicidad, ventasOrganicas]) : null;
  const clicks = sumarEnteros(dias.map((d) => d.clicks));
  const impresiones = sumarEnteros(dias.map((d) => d.impresiones));
  return {
    gasto,
    ventasPublicidad,
    ventasOrganicas,
    ventasTotales,
    clicks,
    impresiones,
    cpc: dividirMonto(gasto, clicks),
    roas: dividirRazon(ventasPublicidad, gasto, 2),
    acos: dividirRazon(gasto, ventasPublicidad, 4),
    tacos: dividirRazon(gasto, ventasTotales, 4),
  };
}

// (actual − anterior) / anterior, en porcentaje con 1 decimal ("12.3" o "-4.1").
// null si falta un lado o el anterior es 0: no hay un 0 % inventado.
export function variacionPorcentual(actual: string | null, anterior: string | null): string | null {
  if (actual === null || anterior === null) return null;
  const a = unidades(actual, ESCALA);
  const b = unidades(anterior, ESCALA);
  if (b === CERO) return null;
  return dividir((a - b) * BigInt(100), b, 1);
}

export function porcentajeDeRazon(numerador: string | null, denominador: string | null): string | null {
  if (numerador === null || denominador === null) return null;
  const n = unidades(numerador, ESCALA);
  const d = unidades(denominador, ESCALA);
  if (d === CERO) return null;
  return dividir(n * BigInt(100), d, 1);
}

function sinGasto(gasto: string | null): boolean {
  if (gasto === null) return true;
  return centavos(gasto) === CERO;
}

function montoPositivo(monto: string | null): boolean {
  if (monto === null) return false;
  return centavos(monto) > CERO;
}

export function semaforoAnuncio(entrada: {
  gasto: string | null;
  ventasPublicidad: string | null;
  precio: string | null;
  config: ConfigPublicidad;
}): Semaforo {
  const { gasto, ventasPublicidad, precio, config } = entrada;
  // Sin gasto (null o 0) no hay ACOS que juzgar, aunque haya ventas
  // atribuidas: un 0 % inventado pintaría verde un anuncio que no se midió.
  if (gasto === null || sinGasto(gasto)) return { estado: "neutro", motivo: "sin_gasto" };
  if (montoPositivo(ventasPublicidad)) {
    const acos = porcentajeDeRazon(gasto, ventasPublicidad);
    if (acos === null || ventasPublicidad === null) return { estado: "neutro", motivo: "sin_gasto" };
    const dentro = razonNoSupera(gasto, ventasPublicidad, config.acosMaximo);
    if (dentro === null) return { estado: "neutro", motivo: "sin_gasto" };
    return { estado: dentro ? "exito" : "peligro", motivo: "acos", acos, tope: config.acosMaximo };
  }
  if (precio === null || sinGasto(precio)) return { estado: "neutro", motivo: "sin_precio" };
  const dentro = razonNoSupera(gasto, precio, config.topeGastoSinVentas);
  if (dentro === null) return { estado: "neutro", motivo: "sin_precio" };
  // 5 % del precio, en centavos, sin float: precio × tope.
  const topeCentavos = dividir(centavos(precio) * unidades(config.topeGastoSinVentas, ESCALA), FACTOR_ESCALA, 0);
  return {
    estado: dentro ? "exito" : "peligro",
    motivo: "gasto",
    gasto,
    precio,
    tope: config.topeGastoSinVentas,
    topeGasto: topeCentavos === null ? "0.00" : desdeCentavos(BigInt(topeCentavos)),
  };
}

// El mayor entre creación y última modificación. `last_updated` de
// Mercado Libre puede moverse por algo que no es un ajuste de la
// campaña: por eso el chip de aprendizaje lleva el enlace para
// verificarlo allá, y no se toma como verdad absoluta.
function ultimaModificacion(creada: Date | null, actualizada: Date | null): Date | null {
  if (!creada) return actualizada;
  if (!actualizada) return creada;
  return creada.getTime() >= actualizada.getTime() ? creada : actualizada;
}

export function diasTranscurridosBogota(desde: Date, hasta: Date): number {
  const a = hoyBogota(desde);
  const b = hoyBogota(hasta);
  if (b < a) return 0;
  return diasEntreInclusive(a, b) - 1;
}

export function diagnosticarCampana(entrada: {
  ahora: Date;
  creadaMlTs: Date | null;
  actualizadaMlTs: Date | null;
  roasObjetivo: string | null;
  totales: TotalesRango;
  config: ConfigPublicidad;
}): Diagnostico {
  const ultima = ultimaModificacion(entrada.creadaMlTs, entrada.actualizadaMlTs);
  if (ultima) {
    const dias = diasTranscurridosBogota(ultima, entrada.ahora);
    if (dias < entrada.config.diasAprendizaje) return { tipo: "aprendiendo", dias };
  }
  const gasto = entrada.totales.gasto;
  const ventas = entrada.totales.ventasPublicidad;
  // Ventas null no es cero: si ningún día trajo monto, no se puede
  // decir que el ROAS quedó bajo el objetivo.
  if (gasto === null || sinGasto(gasto) || ventas === null) return { tipo: "sin_datos", dias: 0 };
  const objetivo = entrada.roasObjetivo;
  if (objetivo === null || centavos(aEscala(objetivo, 2)) <= CERO) return { tipo: "sin_objetivo", dias: 0 };
  const excelente = roasAlcanza(ventas, gasto, objetivo, entrada.config.factorExcelente);
  if (excelente) return { tipo: "excelente", dias: 0 };
  const enObjetivo = roasAlcanza(ventas, gasto, objetivo, "1");
  if (enObjetivo) return { tipo: "en_objetivo", dias: 0 };
  return { tipo: "bajo_objetivo", dias: 0 };
}

function partesIso(iso: string): { anio: number; mes: number; dia: number } {
  const [anio, mes, dia] = iso.split("-").map(Number);
  return { anio, mes, dia };
}

function armarIso(anio: number, mes: number, dia: number): string {
  return `${anio}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

function ultimoDiaDelMes(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

function mesPrevio(anio: number, mes: number): { anio: number; mes: number } {
  if (mes === 1) return { anio: anio - 1, mes: 12 };
  return { anio, mes: mes - 1 };
}

// Mes en curso: del día 1 a hoy (Bogotá), contra el mismo número de
// día del mes anterior. Si ese mes es más corto (31 de marzo contra
// febrero), el corte se queda en su último día. Un mes ya cerrado se
// mira entero y se compara con el mes anterior también entero
// (septiembre 1-30 contra agosto 1-31). Cualquier `mes` que no sea
// AAAA-MM, o que sea futuro, cae al mes en curso.
export function resolverPeriodo(mesParam: string | null | undefined, ahora: Date): Periodo {
  const hoyIso = hoyBogota(ahora);
  const hoy = partesIso(hoyIso);
  let anio = hoy.anio;
  let mes = hoy.mes;
  const coincidencia = typeof mesParam === "string" ? /^(\d{4})-(0[1-9]|1[0-2])$/.exec(mesParam.trim()) : null;
  if (coincidencia) {
    const pedidoAnio = Number(coincidencia[1]);
    const pedidoMes = Number(coincidencia[2]);
    const futuro = pedidoAnio > hoy.anio || (pedidoAnio === hoy.anio && pedidoMes > hoy.mes);
    if (!futuro && pedidoAnio >= 2000) {
      anio = pedidoAnio;
      mes = pedidoMes;
    }
  }
  const esMesEnCurso = anio === hoy.anio && mes === hoy.mes;
  const ultimo = ultimoDiaDelMes(anio, mes);
  const diaHasta = esMesEnCurso ? Math.min(hoy.dia, ultimo) : ultimo;
  const previo = mesPrevio(anio, mes);
  const ultimoPrevio = ultimoDiaDelMes(previo.anio, previo.mes);
  const diaHastaPrevio = esMesEnCurso ? Math.min(diaHasta, ultimoPrevio) : ultimoPrevio;
  return {
    mes: armarIso(anio, mes, 1).slice(0, 7),
    desde: armarIso(anio, mes, 1),
    hasta: armarIso(anio, mes, diaHasta),
    comparacionDesde: armarIso(previo.anio, previo.mes, 1),
    comparacionHasta: armarIso(previo.anio, previo.mes, diaHastaPrevio),
    incluyeHoy: esMesEnCurso,
    esMesEnCurso,
  };
}

export function resolverOrden(valor: string | null | undefined): ColumnaOrden {
  if (valor && (COLUMNAS_ORDEN as readonly string[]).includes(valor)) return valor as ColumnaOrden;
  return "inversion";
}

export function resolverDireccion(valor: string | null | undefined, orden: ColumnaOrden): DireccionOrden {
  if (valor === "asc" || valor === "desc") return valor;
  return orden === "campana" ? "asc" : "desc";
}

export type FilaOrdenable = {
  nombre: string;
  gasto: string | null;
  ventasPublicidad: string | null;
  ventasTotales: string | null;
  roas: string | null;
  acos: string | null;
  tacos: string | null;
  cpc: string | null;
  clicks: string | null;
  impresiones: string | null;
  presupuestoDiario: string | null;
};

function claveOrden(fila: FilaOrdenable, orden: ColumnaOrden): string | null {
  switch (orden) {
    case "campana":
      return fila.nombre;
    case "inversion":
      return fila.gasto;
    case "ventas_publicidad":
      return fila.ventasPublicidad;
    case "ventas_totales":
      return fila.ventasTotales;
    case "roas":
      return fila.roas;
    case "acos":
      return fila.acos;
    case "tacos":
      return fila.tacos;
    case "cpc":
      return fila.cpc;
    case "clics":
      return fila.clicks;
    case "impresiones":
      return fila.impresiones;
    case "presupuesto":
      return fila.presupuestoDiario;
  }
}

export function compararOrden(a: FilaOrdenable, b: FilaOrdenable, orden: ColumnaOrden, dir: DireccionOrden): number {
  const ka = claveOrden(a, orden);
  const kb = claveOrden(b, orden);
  if (ka === null && kb === null) return a.nombre.localeCompare(b.nombre, "es");
  if (ka === null) return 1;
  if (kb === null) return -1;
  let cmp = 0;
  if (orden === "campana") cmp = ka.localeCompare(kb, "es", { sensitivity: "base" });
  else {
    const da = unidades(ka, ESCALA);
    const db = unidades(kb, ESCALA);
    cmp = da < db ? -1 : da > db ? 1 : 0;
  }
  if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
  return a.nombre.localeCompare(b.nombre, "es");
}

// TODO(#255): TACOS de la tienda con ventas de Finanzas
// (pedido_items + pedidos_finanzas, no canceladas, solo lectura).
// No se calcula: solo existen los meses que alguien sincronizó y las
// fechas de ML Ads no tienen zona documentada. La pantalla muestra "—".
export function tacosDeLaTienda(): null {
  return null;
}

export const TOPES_POR_DEFECTO = {
  acos: ACOS_MAXIMO,
  gastoSinVentas: TOPE_GASTO_SIN_VENTAS,
  factorExcelente: FACTOR_EXCELENTE,
};
