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

// Pedido de Sharel/Pablo (15/11): "Conectar marketplace" (antes "Conectar
// Mercado Libre", mismo page.tsx/ruta /panel/conectar-ml, ver Pablo en el
// PR #415) es UNA sola pantalla para los dos canales — estas acciones
// viven junto a las de ML para no repartir la lógica de una misma
// pantalla en dos carpetas.

async function empresaActualOFalla() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) redirect("/crear-empresa");
  return { usuario, empresa };
}

// Mismo bug real ya corregido en esta misma pantalla para Mercado Libre
// (ver MENSAJES_ERROR_CONECTAR en page.tsx): nunca se manda el texto
// crudo de un error a la URL — códigos fijos, con el prefijo
// "falabella_" para no chocar con los códigos de error de ML que ya usa
// esta misma pantalla (ej. "cuenta_en_otra_empresa" ya significa algo
// distinto del lado de Mercado Libre).
export async function conectarCuentaFalabella(formData: FormData) {
  const { usuario, empresa } = await empresaActualOFalla();
  await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");

  const userId = String(formData.get("userId") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "").trim();
  const sellerId = String(formData.get("sellerId") ?? "").trim();
  const nickname = String(formData.get("nickname") ?? "").trim() || userId;

  if (!userId || !apiKey || !sellerId) {
    redirect("/panel/conectar-ml?error=falabella_faltan_datos");
  }

  try {
    const conector = new ConectorFalabella(empresa.id);
    await conector.conectar({ userId, apiKey, sellerId, nickname });
  } catch (error) {
    if (error instanceof CuentaFalabellaDeOtraEmpresaError) {
      redirect("/panel/conectar-ml?error=falabella_cuenta_en_otra_empresa");
    }
    console.warn("[conectar-ml/falabella] no se pudo conectar:", error instanceof Error ? error.message : String(error));
    redirect("/panel/conectar-ml?error=falabella_error_desconocido");
  }

  revalidatePath("/panel/conectar-ml");
  redirect("/panel/conectar-ml?conectado_falabella=1");
}

export async function sincronizarPedidosFalabella(cuentaId: string) {
  const { usuario, empresa } = await empresaActualOFalla();
  await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");

  // Últimos 60 días — mismo criterio que la importación inicial de
  // Mercado Libre (tarea 2.5).
  const desde = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  await pedidosFalabella.importarPedidos(empresa.id, cuentaId, desde);
  revalidatePath("/panel/conectar-ml");
}

export async function desconectarCuentaFalabella(cuentaId: string) {
  const { usuario, empresa } = await empresaActualOFalla();
  await requierePermiso(usuario.id, empresa.id, "configuracion", "modificar");
  await cuentasFalabella.desconectarCuenta(empresa.id, cuentaId);
  revalidatePath("/panel/conectar-ml");
}
