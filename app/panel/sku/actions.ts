"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { crearSku } from "@/lib/ml/sku";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

export async function crearSkuAction(formData: FormData) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);

  await requierePermiso(usuario.id, empresa.id, "inventario", "crear");

  const codigo = String(formData.get("codigo") ?? "").trim();
  const nombre = String(formData.get("nombre") ?? "").trim();
  const nombreBase = String(formData.get("nombreBase") ?? "").trim() || undefined;
  if (!codigo) throw new Error("El código es obligatorio.");
  if (!nombre) throw new Error("El nombre es obligatorio.");

  await crearSku(empresa.id, usuario.id, { codigo, nombre, nombreBase });
  redirect("/panel/sku");
}
