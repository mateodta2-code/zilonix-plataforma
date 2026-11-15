import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { sincronizarVentasCuenta, type ResultadoSyncVentas } from "@/lib/ml/ventas-finanzas";
import { mesActualBogota } from "./ventas-pantalla";

// Issue #131 — botón «Traer ventas de este mes» de Pedidos y Finanzas →
// Ventas. Adelanta el "sincronizar ahora" de la Parte C (camino a #49):
// las ventas importadas antes de #130 no tienen foto financiera y el
// detalle día a día sale vacío. Acá solo se llama, cuenta por cuenta, a
// sincronizarVentasCuenta (lib/ml/ventas-finanzas.ts) desde el primer
// día del mes en curso de Bogotá; el guardado es idempotente, así que
// apretarlo dos veces no duplica nada. Escribe en pedidos_finanzas:
// pide finanzas.modificar, no solo consultar.

export type ResultadoCuentaTraida = { cuentaMlId: string; nickname: string } & (
  | { ok: true; sync: ResultadoSyncVentas }
  | { ok: false; error: string }
);

type Sincronizar = (empresaId: string, cuentaMlId: string, cuentaIdExterna: string, rango: { desde: Date }) => Promise<ResultadoSyncVentas>;

// 00:00 del día 1 del mes en curso en Bogotá (UTC−5, sin horario de
// verano), como instante real.
export function inicioMesBogota(ahora: Date): Date {
  return new Date(`${mesActualBogota(ahora).desde}T00:00:00-05:00`);
}

// cuentaId null = todas las cuentas conectadas de la empresa. Un id que
// no sea una cuenta conectada de ESTA empresa no trae nada (la lista sale
// de cuentas_ml con RLS de la empresa). Si una cuenta falla (token
// vencido, desconectada a medias, ML caído), se anota y se sigue con la
// siguiente.
export async function traerVentasDelMes(
  empresaId: string,
  usuarioId: string,
  cuentaId: string | null,
  ahora: Date,
  sincronizar: Sincronizar = sincronizarVentasCuenta
): Promise<ResultadoCuentaTraida[]> {
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  const desde = inicioMesBogota(ahora);
  const cuentas = (await listarCuentasConectadas(empresaId)).filter((c) => c.desconectadaTs === null && (cuentaId === null || c.id === cuentaId));

  const resultados: ResultadoCuentaTraida[] = [];
  for (const cuenta of cuentas) {
    try {
      const sync = await sincronizar(empresaId, cuenta.id, cuenta.cuentaIdExterna, { desde });
      resultados.push({ cuentaMlId: cuenta.id, nickname: cuenta.nickname, ok: true, sync });
    } catch (error) {
      console.error(`[traer-ventas-mes] la cuenta ${cuenta.id} no se pudo sincronizar:`, error instanceof Error ? error.message : "error desconocido");
      resultados.push({ cuentaMlId: cuenta.id, nickname: cuenta.nickname, ok: false, error: "No se pudo leer de Mercado Libre. Revisa la conexión de la cuenta e inténtalo de nuevo." });
    }
  }
  return resultados;
}

// Una línea por cuenta para la pantalla.
export function textoResultadoCuenta(r: ResultadoCuentaTraida): string {
  if (!r.ok) return `${r.nickname}: ${r.error}`;
  const { leidas, guardadas, fallidas, cortadaPorLimite } = r.sync;
  let texto = `${r.nickname}: ${guardadas} de ${leidas} ${leidas === 1 ? "venta guardada" : "ventas guardadas"}`;
  if (fallidas > 0) texto += `, ${fallidas} con error`;
  if (cortadaPorLimite) texto += ". Mercado Libre frenó por límite de consultas: vuelve a apretar el botón en unos minutos para traer el resto";
  return `${texto}.`;
}
