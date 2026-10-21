"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { vincularPublicacionASku } from "@/lib/ml/sku";

export async function vincularAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");

  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const publicacionId = String(formData.get("publicacionId") ?? "");
  const skuId = String(formData.get("skuId") ?? "");
  if (!publicacionId || !skuId) throw new Error("Falta elegir un SKU.");

  await vincularPublicacionASku(empresa.id, usuario.id, publicacionId, skuId);
  redirect("/panel/sku/sin-vincular");
}
