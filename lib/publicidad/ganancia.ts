// Issue #256 — pestaña "Ganancia real por producto". Lógica pura: arma
// cada fila con margenRealProducto y semaforoMargen (kpis.ts), y aplica
// los filtros y promedios de la pantalla. Solo lectura: nada de acá
// escribe en Mercado Libre ni en la tabla de costos de Finanzas.

import {
  costoTotalProducto,
  envioVendedor,
  margenRealProducto,
  promedioDecimales,
  semaforoMargen,
  type ColorMargen,
  type MargenProducto,
} from "@/lib/publicidad/kpis";
import { aEscala } from "@/lib/numeros/normalizar-decimal";
import { normalizarSkuCodigo } from "@/lib/sku-normalizar";

export const LOGISTICA_FULL = "fulfillment";

// Costos de un SKU según la tabla de costos de Finanzas (los lee
// lib/publicidad/costos.ts, la única lectura).
export type CostoSkuPublicidad = {
  // null = sin costo cargado (0.00 es un $0 real).
  costo: string | null;
  // El del SKU; si está vacío, el de su proveedor; si los dos están
  // vacíos, null (sin dato), igual que el motor de utilidad.
  empaque: string | null;
  envioAgencia: string | null;
};

// SKU de la publicación normalizado como la llave de la maestra. null si
// la publicación no tiene SKU o viene vacío.
export function skuDePublicacion(sku: string | null | undefined): string | null {
  if (!sku || !sku.trim()) return null;
  return normalizarSkuCodigo(sku);
}

export type BandaGanancia = ColorMargen | "sin_dato";
export type FiltroBanda = "todas" | BandaGanancia;
export type FiltroAnunciado = "todos" | "si" | "no";

export type FiltrosGanancia = {
  texto: string;
  banda: FiltroBanda;
  anunciado: FiltroAnunciado;
};

const BANDAS: readonly BandaGanancia[] = ["verde", "amarillo", "rojo", "sin_dato"];
const LARGO_MAXIMO_BUSQUEDA = 100;

// Lo que llega en la URL. Lista blanca: cualquier otro valor cae al
// valor por defecto.
export function leerFiltrosGanancia(entrada: { q?: string | null; banda?: string | null; anunciado?: string | null }): FiltrosGanancia {
  const banda = BANDAS.find((b) => b === entrada.banda) ?? "todas";
  const anunciado: FiltroAnunciado = entrada.anunciado === "si" || entrada.anunciado === "no" ? entrada.anunciado : "todos";
  return {
    texto: (entrada.q ?? "").trim().slice(0, LARGO_MAXIMO_BUSQUEDA),
    banda,
    anunciado,
  };
}

export type EntradaFilaGanancia = {
  itemId: string;
  titulo: string | null;
  // SKU de la publicación tal como vino (sin normalizar). null = no tiene.
  sku: string | null;
  anunciado: boolean;
  precio: string | null;
  precioRegular: string | null;
  comisionMl: string | null;
  envioMl: string | null;
  compradorPagaEnvio: boolean | null;
  logisticType: string | null;
  // undefined = el SKU no está en la tabla de costos de Finanzas.
  costos: CostoSkuPublicidad | undefined;
};

export type EnvioFila = { tipo: "comprador" } | { tipo: "estimado"; monto: string } | { tipo: "sin_dato" };

export type FilaGanancia = {
  itemId: string;
  titulo: string | null;
  sku: string | null;
  anunciado: boolean;
  full: boolean;
  precio: string | null;
  // Solo cuando hay promoción (regular mayor que el vigente).
  precioRegular: string | null;
  // null = falta el costo, el empaque o el envío a agencia.
  costoTotal: string | null;
  comisionMl: string | null;
  envio: EnvioFila;
  resultado: MargenProducto;
  banda: BandaGanancia;
};

function mayorQue(a: string, b: string): boolean {
  return Number(aEscala(a, 2)) > Number(aEscala(b, 2));
}

export function calcularFilaGanancia(entrada: EntradaFilaGanancia, meta: string): FilaGanancia {
  const sku = skuDePublicacion(entrada.sku);
  const full = entrada.logisticType === LOGISTICA_FULL;
  const costos = sku ? entrada.costos : undefined;
  const costo = costos?.costo ?? null;
  const empaque = costos?.empaque ?? null;
  const envioAgencia = costos?.envioAgencia ?? null;
  const resultado = margenRealProducto({
    sku,
    precio: entrada.precio,
    costo,
    empaque,
    envioAgencia,
    full,
    comisionMl: entrada.comisionMl,
    envioMl: entrada.envioMl,
    compradorPagaEnvio: entrada.compradorPagaEnvio,
  });
  const envioMonto = envioVendedor(entrada.compradorPagaEnvio, entrada.envioMl);
  const envio: EnvioFila =
    entrada.compradorPagaEnvio === true
      ? { tipo: "comprador" }
      : envioMonto === null
        ? { tipo: "sin_dato" }
        : { tipo: "estimado", monto: envioMonto };
  const conPromo = entrada.precio !== null && entrada.precioRegular !== null && mayorQue(entrada.precioRegular, entrada.precio);
  return {
    itemId: entrada.itemId,
    titulo: entrada.titulo,
    sku,
    anunciado: entrada.anunciado,
    full,
    precio: entrada.precio,
    precioRegular: conPromo ? entrada.precioRegular : null,
    costoTotal: costoTotalProducto({ costo, empaque, envioAgencia, full }),
    comisionMl: entrada.comisionMl,
    envio,
    resultado,
    banda: resultado.tipo === "ok" ? semaforoMargen(resultado.margen, meta) : "sin_dato",
  };
}

function sinTildes(texto: string): string {
  return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function coincideTexto(fila: FilaGanancia, texto: string): boolean {
  if (!texto) return true;
  const buscado = sinTildes(texto);
  return [fila.titulo, fila.sku, fila.itemId].some((campo) => campo !== null && sinTildes(campo).includes(buscado));
}

function coincideAnunciado(fila: FilaGanancia, anunciado: FiltroAnunciado): boolean {
  if (anunciado === "todos") return true;
  return anunciado === "si" ? fila.anunciado : !fila.anunciado;
}

export type ConteoBandas = Record<"todas" | BandaGanancia, number>;

export type ResultadoGanancia = {
  filas: FilaGanancia[];
  // Conteos con el buscador y el filtro de anunciado aplicados, antes
  // del filtro de banda: así cada botón dice cuántas filas va a mostrar.
  conteos: ConteoBandas;
};

// Primero lo que más preocupa: margen más bajo arriba; las filas sin
// dato al final, por título.
function compararFilas(a: FilaGanancia, b: FilaGanancia): number {
  const ma = a.resultado.tipo === "ok" ? Number(a.resultado.margen) : null;
  const mb = b.resultado.tipo === "ok" ? Number(b.resultado.margen) : null;
  if (ma !== null && mb !== null && ma !== mb) return ma - mb;
  if (ma === null && mb !== null) return 1;
  if (ma !== null && mb === null) return -1;
  return (a.titulo ?? a.itemId).localeCompare(b.titulo ?? b.itemId, "es");
}

export function filtrarGanancia(filas: readonly FilaGanancia[], filtros: FiltrosGanancia): ResultadoGanancia {
  const base = filas.filter((fila) => coincideTexto(fila, filtros.texto) && coincideAnunciado(fila, filtros.anunciado));
  const conteos: ConteoBandas = {
    todas: base.length,
    verde: 0,
    amarillo: 0,
    rojo: 0,
    sin_dato: 0,
  };
  for (const fila of base) conteos[fila.banda] += 1;
  const visibles = filtros.banda === "todas" ? base : base.filter((fila) => fila.banda === filtros.banda);
  return { filas: [...visibles].sort(compararFilas), conteos };
}

export type ResumenGanancia = {
  productos: number;
  // Promedios de las filas que sí calculan (las "sin dato" no cuentan).
  conCalculo: number;
  gananciaPromedio: string | null;
  margenPromedio: string | null;
};

export function resumenGanancia(filas: readonly FilaGanancia[]): ResumenGanancia {
  const calculadas = filas.flatMap((fila) => (fila.resultado.tipo === "ok" ? [fila.resultado] : []));
  return {
    productos: filas.length,
    conCalculo: calculadas.length,
    gananciaPromedio: promedioDecimales(
      calculadas.map((r) => r.ganancia),
      2,
    ),
    margenPromedio: promedioDecimales(
      calculadas.map((r) => r.margen),
      4,
    ),
  };
}
