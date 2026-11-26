"use server";

import { revalidatePath } from "next/cache";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasMlParaSelector, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { inicioMesBogota, textoResultadoCuenta, traerVentasDelMes } from "@/lib/finanzas/traer-ventas-mes";
import { importarPedidos } from "@/lib/falabella/pedidos";
import {
  confirmarRecalculoCostos,
  FiltroRecalculoInvalidoError,
  previsualizarRecalculoCostos,
  RecalculoDesactualizadoError,
  type CambioCosto,
  type OmitidoRecalculo,
  type VistaRecalculo,
} from "@/lib/finanzas/recalcular-costos";
import { parsearFiltroRecalculo, type EntradaFiltroRecalculo, type FiltroRecalculoNormalizado } from "@/lib/finanzas/recalculo-pantalla";
import { and, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasFalabella, pedidosFalabella } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { leerMonto } from "@/lib/importar-archivo";
import { aCentavos } from "@/lib/finanzas/utilidad-venta";

export type EstadoTraerVentas = { ok: boolean; lineas: string[] };

// Issue #131 — «Traer ventas de este mes» (components/finanzas/
// BotonTraerVentasMes.tsx), en Finanzas → Ventas y en Pedidos. Se llama
// directo desde el componente cliente (React 18.3.1: sin
// useFormState/useActionState). El permiso se pide acá y otra vez en
// traerVentasDelMes; la cuenta solo vale si es de la empresa activa.
export async function traerVentasDelMesAction(cuentaParam: string | null): Promise<EstadoTraerVentas> {
  const { usuario, activa: empresa } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, lineas: ["Tu rol no puede traer ventas de Mercado Libre."] };
    throw error;
  }

  const cuentaId = resolverCuentaMl(cuentaParam ?? undefined, await listarCuentasMlParaSelector(empresa.id));
  const resultados = await traerVentasDelMes(empresa.id, usuario.id, cuentaId, new Date());
  revalidatePath("/panel/pedidos");
  revalidatePath("/panel/finanzas/ventas");
  if (resultados.length === 0) return { ok: false, lineas: ["No hay cuentas de Mercado Libre conectadas para traer ventas."] };
  return { ok: resultados.every((r) => r.ok), lineas: resultados.map(textoResultadoCuenta) };
}

// Issue #131 (Parte C) — «Recalcular costo con la tabla maestra»
// (components/finanzas/PanelRecalculoCostos.tsx). La vista previa no
// escribe; la confirmación recalcula de nuevo dentro de la transacción y
// solo escribe si coincide con lo que la persona vio (todo o nada,
// lib/finanzas/recalcular-costos.ts). Las dos piden finanzas.modificar
// acá y otra vez en el motor.
export type EstadoVistaRecalculo =
  | { ok: true; cambios: CambioCosto[]; omitidos: OmitidoRecalculo[]; filtro: FiltroRecalculoNormalizado }
  | { ok: false; lineas: string[] };

export type EstadoConfirmarRecalculo =
  | { ok: true; ventas: number; lineas: number }
  // Si la vista quedó desactualizada, trae la nueva para confirmar otra vez.
  | { ok: false; lineas: string[]; vista?: VistaRecalculo };

type CambioVisto = Pick<CambioCosto, "pedidoId" | "linea" | "antes" | "despues">;

const SIN_PERMISO_RECALCULO = "Tu rol no puede recalcular costos.";

async function contextoRecalculo(): Promise<{ empresaId: string; usuarioId: string } | null> {
  const { usuario, activa: empresa } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) return null;
    throw error;
  }
  return { empresaId: empresa.id, usuarioId: usuario.id };
}

export async function previsualizarRecalculoAction(entrada: EntradaFiltroRecalculo): Promise<EstadoVistaRecalculo> {
  const contexto = await contextoRecalculo();
  if (!contexto) return { ok: false, lineas: [SIN_PERMISO_RECALCULO] };
  const parseado = parsearFiltroRecalculo(entrada);
  if (!parseado.ok) return { ok: false, lineas: [parseado.mensaje] };
  try {
    const vista = await previsualizarRecalculoCostos(contexto.empresaId, contexto.usuarioId, parseado.filtro);
    return { ok: true, cambios: vista.cambios, omitidos: vista.omitidos, filtro: parseado.normalizado };
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, lineas: [SIN_PERMISO_RECALCULO] };
    if (error instanceof FiltroRecalculoInvalidoError) return { ok: false, lineas: [error.message] };
    throw error;
  }
}

export async function confirmarRecalculoAction(entrada: EntradaFiltroRecalculo & { vistos: CambioVisto[] }): Promise<EstadoConfirmarRecalculo> {
  const contexto = await contextoRecalculo();
  if (!contexto) return { ok: false, lineas: [SIN_PERMISO_RECALCULO] };
  const parseado = parsearFiltroRecalculo(entrada);
  if (!parseado.ok) return { ok: false, lineas: [parseado.mensaje] };
  // Solo lo que identifica cada cambio: nada más del cliente llega al motor.
  const vistos = entrada.vistos.map(({ pedidoId, linea, antes, despues }) => ({ pedidoId, linea, antes, despues }));
  try {
    const { ventas, lineas } = await confirmarRecalculoCostos(contexto.empresaId, contexto.usuarioId, parseado.filtro, vistos);
    revalidatePath("/panel/finanzas/ventas");
    revalidatePath("/panel/finanzas");
    revalidatePath("/panel/pedidos");
    return { ok: true, ventas, lineas };
  } catch (error) {
    if (error instanceof RecalculoDesactualizadoError) {
      return { ok: false, lineas: ["Los costos cambiaron desde la vista previa. Mira de nuevo y confirma otra vez."], vista: error.vista };
    }
    if (error instanceof SinPermisoError) return { ok: false, lineas: [SIN_PERMISO_RECALCULO] };
    if (error instanceof FiltroRecalculoInvalidoError) return { ok: false, lineas: [error.message] };
    throw error;
  }
}

// Issue #422 — lápices de la utilidad de Falabella
// (components/finanzas/LapizMontoFalabella.tsx y DefectosCuentaFalabella.tsx).
// finanzas.modificar se pide acá aunque la pantalla ya esconda los
// lápices; cada escritura va con RLS (dbComoEmpresa) y además filtra por
// empresa_id explícito, y deja rastro en `auditoria`. Solo tocan
// pedidos_falabella.costo_manual / flete_manual y los defectos de
// cuentas_falabella: NUNCA costos_sku.
export type EstadoAjusteFalabella = { ok: true } | { ok: false; mensaje: string };

const SIN_PERMISO_AJUSTE = "Tu rol no puede modificar la utilidad de Falabella.";

// Texto de la persona → monto "1234.56" (>= 0), null si vino vacío.
function montoOVacio(valor: string, etiqueta: string): { ok: true; valor: string | null } | { ok: false; mensaje: string } {
  const leido = leerMonto({ tipo: "texto", valor: String(valor ?? "").slice(0, 40) });
  if (leido.tipo === "error") return { ok: false, mensaje: `${etiqueta}: ${leido.mensaje}` };
  return { ok: true, valor: leido.tipo === "monto" ? leido.valor : null };
}

export async function guardarAjusteOrdenFalabellaAction(entrada: {
  pedidoId: string;
  campo: "costo" | "flete";
  valor: string;
}): Promise<EstadoAjusteFalabella> {
  const contexto = await contextoRecalculo();
  if (!contexto) return { ok: false, mensaje: SIN_PERMISO_AJUSTE };
  if (entrada.campo !== "costo" && entrada.campo !== "flete") return { ok: false, mensaje: "Campo inválido." };
  const etiqueta = entrada.campo === "costo" ? "Costo" : "Flete";
  const monto = montoOVacio(entrada.valor, etiqueta);
  if (!monto.ok) return monto;
  const pedidoId = String(entrada.pedidoId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(pedidoId)) return { ok: false, mensaje: "Orden inválida." };

  const { empresaId, usuarioId } = contexto;
  const columna = entrada.campo === "costo" ? { costoManual: monto.valor } : { fleteManual: monto.valor };
  const actualizado = await dbComoEmpresa(empresaId, async (tx) => {
    const [previa] = await tx
      .select({ numero: pedidosFalabella.numeroOrden, externo: pedidosFalabella.pedidoIdExterno, costo: pedidosFalabella.costoManual, flete: pedidosFalabella.fleteManual })
      .from(pedidosFalabella)
      .where(and(eq(pedidosFalabella.id, pedidoId), eq(pedidosFalabella.empresaId, empresaId)));
    if (!previa) return false;
    await tx
      .update(pedidosFalabella)
      .set(columna)
      .where(and(eq(pedidosFalabella.id, pedidoId), eq(pedidosFalabella.empresaId, empresaId)));
    const anterior = entrada.campo === "costo" ? previa.costo : previa.flete;
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "modificar",
      entidad: "pedido_falabella",
      entidadId: pedidoId,
      detalle: `${monto.valor === null ? "Quitó" : "Cambió"} el ${entrada.campo === "costo" ? "costo manual" : "flete manual"} de la orden ${previa.numero ?? previa.externo} de Falabella.`,
      valorAnterior: `${entrada.campo}_manual=${anterior ?? ""}`,
      valorNuevo: `${entrada.campo}_manual=${monto.valor ?? ""}`,
    });
    return true;
  });
  if (!actualizado) return { ok: false, mensaje: "No se encontró la orden." };
  revalidatePath("/panel/finanzas/ventas");
  return { ok: true };
}

export async function guardarDefectosCuentaFalabellaAction(entrada: {
  cuentaId: string;
  comisionPct: string;
  flete: string;
  ivaVentasPct: string;
}): Promise<EstadoAjusteFalabella> {
  const contexto = await contextoRecalculo();
  if (!contexto) return { ok: false, mensaje: SIN_PERMISO_AJUSTE };
  const comision = montoOVacio(entrada.comisionPct, "% comisión");
  if (!comision.ok) return comision;
  // En centavos con BigInt (nada de flotantes): 100 % = 10000.
  if (comision.valor !== null && aCentavos(comision.valor) > BigInt(10000)) {
    return { ok: false, mensaje: "% comisión: tiene que estar entre 0 y 100." };
  }
  const flete = montoOVacio(entrada.flete, "Flete por defecto");
  if (!flete.ok) return flete;
  const iva = montoOVacio(entrada.ivaVentasPct, "% IVA de ventas");
  if (!iva.ok) return iva;
  if (iva.valor !== null && aCentavos(iva.valor) > BigInt(10000)) {
    return { ok: false, mensaje: "% IVA de ventas: tiene que estar entre 0 y 100." };
  }
  const cuentaId = String(entrada.cuentaId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(cuentaId)) return { ok: false, mensaje: "Cuenta inválida." };

  const { empresaId, usuarioId } = contexto;
  const actualizado = await dbComoEmpresa(empresaId, async (tx) => {
    const [previa] = await tx
      .select({ nickname: cuentasFalabella.nickname, comision: cuentasFalabella.comisionDefectoPct, flete: cuentasFalabella.fleteDefecto, iva: cuentasFalabella.ivaVentasPct })
      .from(cuentasFalabella)
      .where(and(eq(cuentasFalabella.id, cuentaId), eq(cuentasFalabella.empresaId, empresaId)));
    if (!previa) return false;
    await tx
      .update(cuentasFalabella)
      .set({ comisionDefectoPct: comision.valor, fleteDefecto: flete.valor, ivaVentasPct: iva.valor })
      .where(and(eq(cuentasFalabella.id, cuentaId), eq(cuentasFalabella.empresaId, empresaId)));
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "modificar",
      entidad: "cuenta_falabella",
      entidadId: cuentaId,
      detalle: `Cambió la comisión, el flete por defecto y el % de IVA de ventas de la cuenta ${previa.nickname} de Falabella.`,
      valorAnterior: `comision_pct=${previa.comision ?? ""} flete=${previa.flete ?? ""} iva_ventas_pct=${previa.iva ?? ""}`,
      valorNuevo: `comision_pct=${comision.valor ?? ""} flete=${flete.valor ?? ""} iva_ventas_pct=${iva.valor ?? ""}`,
    });
    return true;
  });
  if (!actualizado) return { ok: false, mensaje: "No se encontró la cuenta." };
  revalidatePath("/panel/finanzas/ventas");
  return { ok: true };
}

// Issue #422 — «Traer ventas de Falabella» en Finanzas → Ventas y
// utilidad (components/finanzas/BotonTraerVentasFalabella.tsx), para que
// las órdenes nuevas entren sin pasar por Conectar marketplaces (allá
// sincronizarPedidosFalabella pide configuracion.crear y trae 60 días).
// Acá: finanzas.modificar (escribe pedidos_falabella) y solo desde el
// día 1 del mes en curso en Bogotá. importarPedidos es idempotente (ON
// CONFLICT), así que apretarlo dos veces no duplica nada. Si una cuenta
// falla (credenciales, Falabella caído, un monto raro), se anota y se
// sigue con la siguiente. importarPedidos abre su propia transacción por
// cuenta, por eso la auditoría va en una aparte, al final, con el
// resultado real (incluido lo que falló).
export type EstadoTraerVentasFalabella = {
  ok: boolean;
  importados: number;
  cuentasFallidas: string[];
  mensaje: string;
};

export async function traerVentasFalabellaAction(): Promise<EstadoTraerVentasFalabella> {
  const { usuario, activa: empresa } = await obtenerContextoPanel();
  try {
    await requierePermiso(usuario.id, empresa.id, "finanzas", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) {
      return { ok: false, importados: 0, cuentasFallidas: [], mensaje: "Tu rol no puede traer ventas de Falabella." };
    }
    throw error;
  }

  const empresaId = empresa.id;
  const desde = inicioMesBogota(new Date());
  const cuentas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ id: cuentasFalabella.id, nickname: cuentasFalabella.nickname })
      .from(cuentasFalabella)
      .where(and(eq(cuentasFalabella.empresaId, empresaId), isNull(cuentasFalabella.desconectadaTs)))
  );
  if (cuentas.length === 0) {
    return { ok: false, importados: 0, cuentasFallidas: [], mensaje: "No hay cuentas de Falabella conectadas para traer ventas." };
  }

  let importados = 0;
  const cuentasFallidas: string[] = [];
  const cuentasTopadas: string[] = [];
  for (const cuenta of cuentas) {
    try {
      const resultado = await importarPedidos(empresaId, cuenta.id, desde);
      importados += resultado.importados;
      if (resultado.truncado) cuentasTopadas.push(cuenta.nickname);
    } catch (error) {
      // Solo el mensaje al log (nunca datos del comprador ni credenciales).
      console.warn(`[finanzas/falabella] la cuenta ${cuenta.id} no se pudo traer:`, error instanceof Error ? error.message : "error desconocido");
      cuentasFallidas.push(cuenta.nickname);
    }
  }

  await dbComoEmpresa(empresaId, (tx) =>
    registrarAuditoria(tx, {
      empresaId,
      usuarioId: usuario.id,
      actorTipo: "persona",
      accion: "sincronizar",
      entidad: "pedido_falabella",
      detalle:
        `Trajo ${importados} ${importados === 1 ? "pedido" : "pedidos"} de Falabella desde el ${desde.toISOString().slice(0, 10)} ` +
        `(${cuentas.length - cuentasFallidas.length} de ${cuentas.length} cuentas)` +
        (cuentasFallidas.length > 0 ? `. Fallaron: ${cuentasFallidas.join(", ")}.` : "."),
    })
  );
  revalidatePath("/panel/finanzas/ventas");
  revalidatePath("/panel/pedidos");

  let mensaje = `${importados} ${importados === 1 ? "pedido traído" : "pedidos traídos"} de Falabella este mes.`;
  if (cuentasFallidas.length > 0) mensaje += ` No se pudo leer: ${cuentasFallidas.join(", ")}. Revisa la conexión de esas cuentas.`;
  if (cuentasTopadas.length > 0) mensaje += ` ${cuentasTopadas.join(", ")} llegó al tope de órdenes que se leen de una vez: puede faltar alguna del mes.`;
  return { ok: cuentasFallidas.length === 0, importados, cuentasFallidas, mensaje };
}
