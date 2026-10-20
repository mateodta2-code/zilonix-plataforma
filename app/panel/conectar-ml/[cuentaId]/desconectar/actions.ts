"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { desconectarCuenta } from "@/lib/ml/cuentas";

export async function desconectarCuentaAction(cuentaId: string) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  await requierePermiso(usuario.id, empresa.id, "configuracion", "modificar");

  // Tarea 2.3 — regla de UX #3 (evidencia real de UpSeller: al
  // desconectar una tienda, sus pedidos dejaban de verse sin aviso ni
  // forma de recuperar el histórico). desconectarCuenta() SOLO marca
  // desconectada_ts, nunca borra la fila ni nada de lo que ya se
  // hubiera importado — desconectar nunca es borrar.
  await desconectarCuenta(empresa.id, cuentaId);

  redirect("/panel/conectar-ml");
}
