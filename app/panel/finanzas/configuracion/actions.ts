"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guardarValorFlex } from "@/lib/configuracion-finanzas";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { MontoInvalidoError } from "@/lib/finanzas/montos";
import { leerMonto } from "@/lib/importar-archivo";
import { requierePermiso } from "@/lib/permisos";

// Issue #126 (slice urgente) — guardar el valor fijo de envío Flex de la
// empresa activa. Pide finanzas.modificar acá y otra vez en
// guardarValorFlex (lib/configuracion-finanzas.ts), que deja el rastro en
// `auditoria` con el valor anterior y el nuevo.

const RUTA = "/panel/finanzas/configuracion";

export async function guardarValorFlexAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  let destino: string;
  try {
    // Mismo formato de montos que la tabla maestra: 10000, 10.000 o 10.000,50.
    const leido = leerMonto({ tipo: "texto", valor: String(formData.get("flexValor") ?? "") });
    if (leido.tipo !== "monto") throw new MontoInvalidoError("Valor Flex");
    await guardarValorFlex(empresaId, usuarioId, leido.valor);
    revalidatePath(RUTA);
    revalidatePath("/panel/finanzas/ventas");
    destino = conMensaje(RUTA, "ok", "Valor Flex guardado. Usa «Traer ventas de este mes» para congelar las ventas Flex que salían sin costo.");
  } catch (error) {
    if (!(error instanceof MontoInvalidoError)) throw error;
    destino = conMensaje(RUTA, "error", error.message);
  }
  redirect(destino);
}
