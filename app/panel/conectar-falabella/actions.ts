"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { ConectorFalabella } from "@/lib/conectores/falabella";
import { CuentaFalabellaDeOtraEmpresaError } from "@/lib/falabella/cuentas";
import * as cuentasFalabella from "@/lib/falabella/cuentas";
import * as pedidosFalabella from "@/lib/falabella/pedidos";

async function empresaActualOFalla() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  return { usuario, empresa };
}

// Mismo bug real ya corregido en /panel/conectar-ml (ver comentario de
// MENSAJES_ERROR_CONECTAR en su page.tsx): nunca se manda el texto crudo
// de un error a la URL — un mapa cerrado de códigos fijos, el detalle
// real (incluido lo que responda la API de Falabella) solo se loguea
// server-side.
export async function conectarCuentaFalabella(formData: FormData) {
  const { usuario, empresa } = await empresaActualOFalla();
  await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");

  const userId = String(formData.get("userId") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const sellerId = String(formData.get("sellerId") ?? "").trim();
  const nickname = String(formData.get("nickname") ?? "").trim() || userId;

  if (!userId || !apiKey || !sellerId) {
    redirect("/panel/conectar-falabella?error=faltan_datos");
  }

  try {
    const conector = new ConectorFalabella(empresa.id);
    await conector.conectar({ userId, apiKey, sellerId, nickname });
  } catch (error) {
    if (error instanceof CuentaFalabellaDeOtraEmpresaError) {
      redirect("/panel/conectar-falabella?error=cuenta_en_otra_empresa");
    }
    console.warn("[conectar-falabella] no se pudo conectar:", error instanceof Error ? error.message : String(error));
    redirect("/panel/conectar-falabella?error=error_desconocido");
  }

  revalidatePath("/panel/conectar-falabella");
  redirect("/panel/conectar-falabella?conectado=1");
}

export async function sincronizarPedidosFalabella(cuentaId: string) {
  const { usuario, empresa } = await empresaActualOFalla();
  await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");

  // Últimos 60 días — mismo criterio que la importación inicial de
  // Mercado Libre (tarea 2.5), para no pedir desde siempre en cada
  // sincronización manual.
  const desde = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await pedidosFalabella.importarPedidos(empresa.id, cuentaId, desde);
  revalidatePath("/panel/conectar-falabella");
}

export async function desconectarCuentaFalabella(cuentaId: string) {
  const { usuario, empresa } = await empresaActualOFalla();
  await requierePermiso(usuario.id, empresa.id, "configuracion", "modificar");
  await cuentasFalabella.desconectarCuenta(empresa.id, cuentaId);
  revalidatePath("/panel/conectar-falabella");
}
