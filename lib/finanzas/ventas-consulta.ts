// Issue #131 (Z-FIN-09, Parte A) — lecturas de la pantalla de ventas y
// utilidad. Solo lee: nunca escribe en la base ni toca lo congelado (el
// recálculo con el costo actual es la Parte C, recalcular-costos.ts).
//
// Pocas consultas en lote, nada de N+1: cabeceras (con pedido y cuenta)
// del rango, después todas sus líneas y todas sus correcciones con
// inArray. Todo dentro de dbComoEmpresa (RLS), después de
// requierePermiso("finanzas", "consultar"). Ningún texto del usuario
// entra al SQL: las fechas llegan como Date ya validadas y la cuenta es
// un id ya resuelto contra la lista de la empresa
// (lib/ml/selector-cuenta.ts).
//
// Las sumas las hace el motor (utilidad-venta.ts) y el detalle
// (detalle-ventas.ts) en BigInt. Si un mes de 16 cuentas carga lento, la
// optimización con agregación SQL queda anotada para después.

import { and, asc, eq, gte, inArray, lt, notInArray } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, pedidoItems, pedidos, pedidosFinanzas, usuarios, ventasCorrecciones } from "@/db/schema";
import { ESTADOS_QUE_NO_SON_VENTA } from "@/lib/estados-venta";
import { requierePermiso } from "@/lib/permisos";
import { armarDetalleVentas, type DetalleVentas } from "./detalle-ventas";
import {
  CAMPOS_CORREGIBLES,
  EntradaUtilidadInvalidaError,
  aCentavos,
  calcularUtilidadVenta,
  type CampoCorregible,
  type ResultadoVenta,
} from "./utilidad-venta";
import {
  RANGO_MAXIMO_DIAS,
  armarVentaEntrada,
  resumirPorCuenta,
  type AvisoArmado,
  type CabeceraVentaFila,
  type CorreccionVentaFila,
  type LineaVentaFila,
  type ResumenCuenta,
} from "./ventas-pantalla";

const CERO = BigInt(0);
const DIA_MS = 24 * 60 * 60 * 1000;
// Postgres acepta hasta 65535 parámetros por consulta: los ids van en
// tandas para que un mes grande no rompa el inArray.
const TANDA_IDS = 5_000;
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RangoVentasInvalidoError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "RangoVentasInvalidoError";
  }
}

export type FiltroVentasUtilidad = {
  // null = todas las cuentas de la empresa.
  cuentaId: string | null;
  desde: Date;
  hastaExclusivo: Date;
  costo?: "con" | "sin";
};

export type VentaRechazada = { pedidoId: string; pedidoIdExterno: string; motivo: string };

export type ResultadoVentasUtilidad = {
  detalle: DetalleVentas;
  resumenCuentas: ResumenCuenta[];
  // pedido_id → pedido_id_externo, para enlazar y mostrar el número de ML.
  pedidoIdExterno: Record<string, string>;
  // Pedidos con reembolsos > 0: marca "con devolución · revisar".
  conDevolucion: string[];
  // Avisos del armado (comisión o flete sin dato) por pedido.
  avisosArmado: Record<string, AvisoArmado[]>;
  // Ventas que el motor rechazó: no rompen la página, se listan aparte.
  rechazadas: VentaRechazada[];
};

function validarFiltro(filtro: FiltroVentasUtilidad): void {
  const { desde, hastaExclusivo } = filtro;
  if (!(desde instanceof Date) || !(hastaExclusivo instanceof Date) || Number.isNaN(desde.getTime()) || Number.isNaN(hastaExclusivo.getTime())) {
    throw new RangoVentasInvalidoError("El rango de fechas no es válido.");
  }
  if (hastaExclusivo <= desde) throw new RangoVentasInvalidoError("La fecha «hasta» no puede ser anterior a «desde».");
  if (hastaExclusivo.getTime() - desde.getTime() > RANGO_MAXIMO_DIAS * DIA_MS) {
    throw new RangoVentasInvalidoError(`El rango puede tener como máximo ${RANGO_MAXIMO_DIAS} días.`);
  }
  if (filtro.costo !== undefined && filtro.costo !== "con" && filtro.costo !== "sin") {
    throw new RangoVentasInvalidoError("Filtro de costo desconocido.");
  }
}

function enTandas<T>(lista: T[]): T[][] {
  const tandas: T[][] = [];
  for (let i = 0; i < lista.length; i += TANDA_IDS) tandas.push(lista.slice(i, i + TANDA_IDS));
  return tandas;
}

function esCampoCorregible(campo: string): campo is CampoCorregible {
  return (CAMPOS_CORREGIBLES as readonly string[]).includes(campo);
}

type FilaLinea = LineaVentaFila & { pedidoId: string; titulo: string; skuCodigo: string | null };
type FilaCorreccion = CorreccionVentaFila & { pedidoId: string };

export async function listarVentasUtilidad(
  empresaId: string,
  usuarioId: string,
  filtro: FiltroVentasUtilidad
): Promise<ResultadoVentasUtilidad> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  validarFiltro(filtro);

  const { cabeceras, lineas, correcciones } = await dbComoEmpresa(empresaId, async (tx) => {
    const condiciones = [
      gte(pedidos.fecha, filtro.desde),
      lt(pedidos.fecha, filtro.hastaExclusivo),
      // Sin ícono de quitar (#131): las cancelled/invalid y las canceladas
      // por reembolso total no aparecen ni suman.
      notInArray(pedidos.estado, ESTADOS_QUE_NO_SON_VENTA),
      eq(pedidosFinanzas.cancelada, false),
    ];
    if (filtro.cuentaId) condiciones.push(eq(pedidosFinanzas.cuentaMlId, filtro.cuentaId));

    const cabeceras = await tx
      .select({
        pedidoId: pedidosFinanzas.pedidoId,
        cuentaMlId: pedidosFinanzas.cuentaMlId,
        formaEntrega: pedidosFinanzas.formaEntrega,
        fechaPagoAprobado: pedidosFinanzas.fechaPagoAprobado,
        valorVenta: pedidosFinanzas.valorVenta,
        reembolsos: pedidosFinanzas.reembolsos,
        comisionMl: pedidosFinanzas.comisionMl,
        fleteMl: pedidosFinanzas.fleteMl,
        empaqueCongelado: pedidosFinanzas.empaqueCongelado,
        envioAgenciaCongelado: pedidosFinanzas.envioAgenciaCongelado,
        cancelada: pedidosFinanzas.cancelada,
        fechaDespacho: pedidosFinanzas.fechaDespacho,
        fechaEntrega: pedidosFinanzas.fechaEntrega,
        fechaCreacion: pedidos.fecha,
        estado: pedidos.estado,
        pedidoIdExterno: pedidos.pedidoIdExterno,
        nickname: cuentasMl.nickname,
      })
      .from(pedidosFinanzas)
      .innerJoin(pedidos, eq(pedidos.id, pedidosFinanzas.pedidoId))
      .innerJoin(cuentasMl, eq(cuentasMl.id, pedidosFinanzas.cuentaMlId))
      .where(and(...condiciones));

    const ids = cabeceras.map((c) => c.pedidoId);
    const lineas: FilaLinea[] = [];
    const correcciones: FilaCorreccion[] = [];
    for (const tanda of enTandas(ids)) {
      lineas.push(
        ...(await tx
          .select({
            pedidoId: pedidoItems.pedidoId,
            linea: pedidoItems.linea,
            cantidad: pedidoItems.cantidad,
            valorLinea: pedidoItems.valorLinea,
            costoCongelado: pedidoItems.costoCongelado,
            empaqueCongelado: pedidoItems.empaqueCongelado,
            envioCongelado: pedidoItems.envioCongelado,
            titulo: pedidoItems.titulo,
            skuCodigo: pedidoItems.skuCodigo,
          })
          .from(pedidoItems)
          .where(inArray(pedidoItems.pedidoId, tanda)))
      );
      correcciones.push(
        ...(await tx
          .select({
            pedidoId: ventasCorrecciones.pedidoId,
            linea: ventasCorrecciones.linea,
            campo: ventasCorrecciones.campo,
            valorNuevo: ventasCorrecciones.valorNuevo,
            anuladaTs: ventasCorrecciones.anuladaTs,
          })
          .from(ventasCorrecciones)
          .where(inArray(ventasCorrecciones.pedidoId, tanda)))
      );
    }
    return { cabeceras, lineas, correcciones };
  });

  const lineasPorPedido = agrupar(lineas);
  const correccionesPorPedido = agrupar(correcciones);

  const pedidoIdExterno: Record<string, string> = {};
  const conDevolucion: string[] = [];
  const avisosArmado: Record<string, AvisoArmado[]> = {};
  const rechazadas: VentaRechazada[] = [];
  const entradasDetalle = [];

  for (const cabecera of cabeceras) {
    pedidoIdExterno[cabecera.pedidoId] = cabecera.pedidoIdExterno;
    const lineasVenta = lineasPorPedido.get(cabecera.pedidoId) ?? [];
    let resultado: ResultadoVenta;
    try {
      const { entrada, avisos } = armarVentaEntrada(
        cabecera as CabeceraVentaFila,
        lineasVenta,
        (correccionesPorPedido.get(cabecera.pedidoId) ?? []).map(validarCorreccion)
      );
      resultado = calcularUtilidadVenta(entrada);
      if (avisos.length) avisosArmado[cabecera.pedidoId] = avisos;
    } catch (error) {
      if (!(error instanceof EntradaUtilidadInvalidaError)) throw error;
      rechazadas.push({ pedidoId: cabecera.pedidoId, pedidoIdExterno: cabecera.pedidoIdExterno, motivo: error.message });
      continue;
    }
    if (filtro.costo === "con" && !resultado.con_costo) continue;
    if (filtro.costo === "sin" && resultado.con_costo) continue;
    if (aCentavos(cabecera.reembolsos) > CERO) conDevolucion.push(cabecera.pedidoId);
    entradasDetalle.push({
      resultado,
      estado: cabecera.estado,
      cancelada: cabecera.cancelada,
      fecha_creacion: cabecera.fechaCreacion,
      fecha_despacho: cabecera.fechaDespacho,
      fecha_entrega: cabecera.fechaEntrega,
      cuenta_nickname: cabecera.nickname,
      lineas: lineasVenta.map((l) => ({ linea: l.linea, titulo: l.titulo, sku_codigo: l.skuCodigo })),
    });
  }

  const detalle = armarDetalleVentas(entradasDetalle, { agruparPor: "creacion" });
  rechazadas.sort((a, b) => (a.pedidoIdExterno < b.pedidoIdExterno ? -1 : 1));
  return { detalle, resumenCuentas: resumirPorCuenta(detalle), pedidoIdExterno, conDevolucion, avisosArmado, rechazadas };
}

function agrupar<T extends { pedidoId: string }>(filas: T[]): Map<string, T[]> {
  const mapa = new Map<string, T[]>();
  for (const fila of filas) {
    const lista = mapa.get(fila.pedidoId);
    if (lista) lista.push(fila);
    else mapa.set(fila.pedidoId, [fila]);
  }
  return mapa;
}

// La base ya restringe `campo` a la lista cerrada (CHECK de #129); se
// revisa igual porque llega tipado como texto.
function validarCorreccion(c: { linea: number | null; campo: string; valorNuevo: string; anuladaTs: Date | null }): CorreccionVentaFila {
  if (!esCampoCorregible(c.campo)) throw new EntradaUtilidadInvalidaError(`Campo de corrección fuera de la lista: ${JSON.stringify(c.campo)}`);
  return { linea: c.linea, campo: c.campo, valorNuevo: c.valorNuevo, anuladaTs: c.anuladaTs };
}

// ---------------------------------------------------------------------------
// Detalle de una venta
// ---------------------------------------------------------------------------

export type CorreccionDetalle = {
  id: string;
  linea: number | null;
  campo: CampoCorregible;
  valorNuevo: string;
  nota: string;
  creadoPorNombre: string;
  creadoTs: Date;
  anuladaTs: Date | null;
};

export type LineaDetalleVenta = {
  linea: number;
  titulo: string;
  skuCodigo: string | null;
  cantidad: number;
  imagenUrl: string | null;
};

export type DetalleVentaUtilidad = {
  pedidoId: string;
  pedidoIdExterno: string;
  nickname: string;
  estado: string;
  fechaCreacion: Date;
  fechaPagoAprobado: Date | null;
  formaEntrega: CabeceraVentaFila["formaEntrega"];
  reembolsos: string;
  // reembolsos > 0: marca "con devolución · revisar".
  conDevolucion: boolean;
  cancelada: boolean;
  estadoCosteo: string;
  congeladoTs: Date | null;
  lineas: LineaDetalleVenta[];
  // Activas y anuladas, de la más nueva a la más vieja.
  correcciones: CorreccionDetalle[];
  avisosArmado: AvisoArmado[];
  // null si el motor rechazó la venta (motivo en `error`).
  resultado: ResultadoVenta | null;
  error: string | null;
};

// null si el id no es de una venta con foto financiera de ESTA empresa:
// RLS ya filtra la otra empresa, y además se exige empresa_id en el WHERE.
export async function obtenerDetalleVentaUtilidad(
  empresaId: string,
  usuarioId: string,
  pedidoId: string
): Promise<DetalleVentaUtilidad | null> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "consultar");
  if (!PATRON_UUID.test(pedidoId)) return null;

  const datos = await dbComoEmpresa(empresaId, async (tx) => {
    const [cabecera] = await tx
      .select({
        pedidoId: pedidosFinanzas.pedidoId,
        cuentaMlId: pedidosFinanzas.cuentaMlId,
        formaEntrega: pedidosFinanzas.formaEntrega,
        fechaPagoAprobado: pedidosFinanzas.fechaPagoAprobado,
        valorVenta: pedidosFinanzas.valorVenta,
        reembolsos: pedidosFinanzas.reembolsos,
        comisionMl: pedidosFinanzas.comisionMl,
        fleteMl: pedidosFinanzas.fleteMl,
        empaqueCongelado: pedidosFinanzas.empaqueCongelado,
        envioAgenciaCongelado: pedidosFinanzas.envioAgenciaCongelado,
        cancelada: pedidosFinanzas.cancelada,
        estadoCosteo: pedidosFinanzas.estadoCosteo,
        congeladoTs: pedidosFinanzas.congeladoTs,
        fechaCreacion: pedidos.fecha,
        estado: pedidos.estado,
        pedidoIdExterno: pedidos.pedidoIdExterno,
        nickname: cuentasMl.nickname,
      })
      .from(pedidosFinanzas)
      .innerJoin(pedidos, eq(pedidos.id, pedidosFinanzas.pedidoId))
      .innerJoin(cuentasMl, eq(cuentasMl.id, pedidosFinanzas.cuentaMlId))
      .where(and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.pedidoId, pedidoId)));
    if (!cabecera) return null;

    const lineas = await tx
      .select({
        linea: pedidoItems.linea,
        cantidad: pedidoItems.cantidad,
        valorLinea: pedidoItems.valorLinea,
        costoCongelado: pedidoItems.costoCongelado,
        empaqueCongelado: pedidoItems.empaqueCongelado,
        envioCongelado: pedidoItems.envioCongelado,
        titulo: pedidoItems.titulo,
        skuCodigo: pedidoItems.skuCodigo,
        imagenUrl: pedidoItems.imagenUrl,
      })
      .from(pedidoItems)
      .where(eq(pedidoItems.pedidoId, pedidoId))
      .orderBy(asc(pedidoItems.linea));

    // usuarios no lleva RLS (puede estar en varias empresas): solo se
    // pide el nombre de quien creó cada corrección de esta venta.
    const correcciones = await tx
      .select({
        id: ventasCorrecciones.id,
        linea: ventasCorrecciones.linea,
        campo: ventasCorrecciones.campo,
        valorNuevo: ventasCorrecciones.valorNuevo,
        nota: ventasCorrecciones.nota,
        creadoTs: ventasCorrecciones.creadoTs,
        anuladaTs: ventasCorrecciones.anuladaTs,
        creadoPorNombre: usuarios.nombre,
      })
      .from(ventasCorrecciones)
      .leftJoin(usuarios, eq(usuarios.id, ventasCorrecciones.creadoPor))
      .where(eq(ventasCorrecciones.pedidoId, pedidoId))
      .orderBy(asc(ventasCorrecciones.creadoTs));
    return { cabecera, lineas, correcciones };
  });
  if (!datos) return null;
  const { cabecera, lineas, correcciones } = datos;

  let resultado: ResultadoVenta | null = null;
  let error: string | null = null;
  let avisosArmado: AvisoArmado[] = [];
  try {
    const armado = armarVentaEntrada(cabecera as CabeceraVentaFila, lineas, correcciones.map(validarCorreccion));
    avisosArmado = armado.avisos;
    resultado = calcularUtilidadVenta(armado.entrada);
  } catch (e) {
    if (!(e instanceof EntradaUtilidadInvalidaError)) throw e;
    error = e.message;
  }

  return {
    pedidoId: cabecera.pedidoId,
    pedidoIdExterno: cabecera.pedidoIdExterno,
    nickname: cabecera.nickname,
    estado: cabecera.estado,
    fechaCreacion: cabecera.fechaCreacion,
    fechaPagoAprobado: cabecera.fechaPagoAprobado,
    formaEntrega: cabecera.formaEntrega,
    reembolsos: cabecera.reembolsos,
    conDevolucion: aCentavos(cabecera.reembolsos) > CERO,
    cancelada: cabecera.cancelada,
    estadoCosteo: cabecera.estadoCosteo,
    congeladoTs: cabecera.congeladoTs,
    lineas: lineas.map((l) => ({ linea: l.linea, titulo: l.titulo, skuCodigo: l.skuCodigo, cantidad: l.cantidad, imagenUrl: l.imagenUrl })),
    correcciones: correcciones
      .map((c) => ({
        id: c.id,
        linea: c.linea,
        campo: validarCorreccion(c).campo,
        valorNuevo: c.valorNuevo,
        nota: c.nota,
        creadoPorNombre: c.creadoPorNombre ?? "Usuario eliminado",
        creadoTs: c.creadoTs,
        anuladaTs: c.anuladaTs,
      }))
      .reverse(),
    avisosArmado,
    resultado,
    error,
  };
}

// Para el enlace "Ver utilidad" del detalle de un pedido: solo si el
// pedido ya tiene foto financiera. Quien llama ya comprobó
// finanzas.consultar (sin permiso no se pregunta).
export async function tieneVentaFinanzas(empresaId: string, pedidoId: string): Promise<boolean> {
  if (!PATRON_UUID.test(pedidoId)) return false;
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: pedidosFinanzas.id })
      .from(pedidosFinanzas)
      .where(and(eq(pedidosFinanzas.empresaId, empresaId), eq(pedidosFinanzas.pedidoId, pedidoId)))
      .limit(1)
  );
  return filas.length > 0;
}
