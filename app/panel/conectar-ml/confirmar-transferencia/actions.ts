"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { confirmarTransferenciaCuentaMl } from "@/lib/ml/transferencia";
import { descifrarTransferenciaPendiente, NOMBRE_COOKIE_TRANSFERENCIA, OPCIONES_COOKIE_TRANSFERENCIA } from "@/lib/ml/transferencia-cookie";

// El permiso real (requierePermiso('configuracion', 'crear')) vive en
// confirmarTransferenciaCuentaMl (lib/ml/transferencia.ts), llamado
// ANTES de tocar la base — mismo patrón que
// previsualizarImportacionSkus/confirmarImportacionSkus en
// lib/ml/sku-importar.ts (ver scripts/verificar-permisos.test.ts,
// RUTAS_EXENTAS). Este archivo solo resuelve usuario/empresa desde las
// cookies y borra la cookie de transferencia al salir, en los dos
// caminos (confirmar o cancelar).
function borrarCookiePendiente() {
  cookies().set(NOMBRE_COOKIE_TRANSFERENCIA, "", { ...OPCIONES_COOKIE_TRANSFERENCIA, maxAge: 0 });
}

export async function confirmarTransferenciaAction() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  const valorCookie = cookies().get(NOMBRE_COOKIE_TRANSFERENCIA)?.value;
  const pendiente = valorCookie ? descifrarTransferenciaPendiente(valorCookie) : null;
  if (!pendiente) redirect("/panel/conectar-ml?error=estado_vencido");

  await confirmarTransferenciaCuentaMl(usuario.id, empresa.id, pendiente);

  borrarCookiePendiente();
  redirect("/panel/conectar-ml?conectado=1");
}

// Cancelar: NUNCA toca la otra empresa, solo descarta el pendiente de
// esta sesión — pedido explícito del issue #181.
export async function cancelarTransferenciaAction() {
  borrarCookiePendiente();
  redirect("/panel/conectar-ml");
}
