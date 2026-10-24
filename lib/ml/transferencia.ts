import { transferirCuentaMlAOtraEmpresa } from "@/lib/ml/cuentas";
import { ejecutarImportacionInicial } from "@/lib/ml/importacion";
import type { TokensMl } from "@/lib/ml/oauth";
import { requierePermiso } from "@/lib/permisos";

// Issue #181 — aparte de lib/ml/cuentas.ts (que solo toca cuentas_ml, a
// propósito nunca pide ningún permiso por su cuenta) para evitar un
// import circular: lib/ml/importacion.ts ya importa de lib/ml/cuentas.ts
// (obtenerAccessTokenVigente), así que cuentas.ts no puede importar de
// vuelta a importacion.ts.
//
// Mismo patrón que lib/ml/sku-importar.ts (primera función de lib/ml/
// que llama requierePermiso() por su cuenta): el permiso real vive
// ACÁ, llamado ANTES de tocar la base — el Server Action
// (app/panel/conectar-ml/confirmar-transferencia/actions.ts) solo
// resuelve usuario/empresa desde las cookies y llama esta función.
export async function confirmarTransferenciaCuentaMl(
  usuarioId: string,
  empresaId: string,
  datos: { cuentaIdExterna: string; nickname: string; tokens: TokensMl }
): Promise<{ id: string }> {
  await requierePermiso(usuarioId, empresaId, "configuracion", "crear");

  const cuenta = await transferirCuentaMlAOtraEmpresa(empresaId, datos);

  // Tarea 2.5 — mismo criterio que app/api/ml/callback/route.ts: en
  // segundo plano, sin await, nunca tumba la confirmación si falla.
  ejecutarImportacionInicial(empresaId, cuenta.id, datos.cuentaIdExterna).catch((error) => {
    console.error("Error en la importación inicial tras transferir la cuenta:", error instanceof Error ? error.message : error);
  });

  return cuenta;
}
