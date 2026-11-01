"use server";

import { revalidatePath } from "next/cache";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasMlParaSelector, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { textoResultadoCuenta, traerVentasDelMes } from "@/lib/finanzas/traer-ventas-mes";
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
