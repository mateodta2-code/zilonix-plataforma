import { eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { pedidos } from "@/db/schema";
import { obtenerCuentaMlActiva } from "@/lib/ml/cuentas";

// Issue #323 — checklist de /panel ("crear empresa → conectar 1 cuenta
// ML → ver 1 pedido"). "Crear empresa" ni se consulta: si hay
// empresaId para preguntar esto es porque ya existe la fila (siempre
// hecho). Los otros dos pasos se calculan en vivo contra las tablas
// que ya existen — nada nuevo que guardar ni migrar. "Conectada"
// cuenta solo una cuenta SIN desconectar (obtenerCuentaMlActiva, lib/
// ml/cuentas.ts): una cuenta que se desconectó no cuenta como "ya
// pasé este paso" de nuevo.
export type ProgresoOnboarding = {
  cuentaConectada: boolean;
  pedidoVisto: boolean;
  completo: boolean;
};

async function hayAlgunPedido(empresaId: string): Promise<boolean> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ id: pedidos.id }).from(pedidos).where(eq(pedidos.empresaId, empresaId)).limit(1)
  );
  return fila !== undefined;
}

export async function obtenerProgresoOnboarding(empresaId: string): Promise<ProgresoOnboarding> {
  const [cuentaActiva, pedidoVisto] = await Promise.all([obtenerCuentaMlActiva(empresaId), hayAlgunPedido(empresaId)]);
  const cuentaConectada = cuentaActiva !== null;
  return { cuentaConectada, pedidoVisto, completo: cuentaConectada && pedidoVisto };
}
