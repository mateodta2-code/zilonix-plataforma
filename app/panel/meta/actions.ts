"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { fijarMetaDelMes } from "@/lib/finanzas/meta-mes";
import { leerMonto } from "@/lib/importar-archivo";
import { MetaMensualInvalidaError } from "@/lib/metas-mensuales";
import { requiereDueno, requierePermiso, SoloDuenoError } from "@/lib/permisos";

// Inicio (13-nov; #125/#126) — fijar la meta de utilidad del mes en
// curso. Solo el Dueño: pide finanzas.modificar y requiereDueno acá y
// otra vez en fijarMetaDelMes (lib/finanzas/meta-mes.ts), que guarda con
// guardarMetaMensual y deja el rastro en la bitácora.
export async function fijarMetaAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
  await requiereDueno(usuarioId, empresaId);

  let destino: string;
  try {
    const leido = leerMonto({ tipo: "texto", valor: String(formData.get("meta") ?? "") });
    if (leido.tipo !== "monto") throw new MetaMensualInvalidaError("Escribe la meta como un monto, por ejemplo 20.000.000.");
    await fijarMetaDelMes(empresaId, usuarioId, new Date(), leido.valor);
    revalidatePath("/panel");
    destino = conMensaje("/panel", "ok", "Meta del mes guardada.");
  } catch (error) {
    if (!(error instanceof MetaMensualInvalidaError) && !(error instanceof SoloDuenoError)) throw error;
    destino = conMensaje("/panel", "error", error.message);
  }
  redirect(destino);
}
