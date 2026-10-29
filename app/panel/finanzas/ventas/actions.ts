"use server";

import { revalidatePath } from "next/cache";
import { obtenerContextoPanel } from "@/lib/panel-contexto";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { listarCuentasMlParaSelector, resolverCuentaMl } from "@/lib/ml/selector-cuenta";
import { textoResultadoCuenta, traerVentasDelMes } from "@/lib/finanzas/traer-ventas-mes";

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
