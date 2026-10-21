"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { buscarItemPorSku, subirClipItem, validarArchivoClip } from "@/lib/ml/clip";
import { cambiarEstadoItemMl } from "@/lib/ml/estado-item";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

export async function buscarItemAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");

  const cuentaId = String(formData.get("cuentaId") ?? "");
  const sku = String(formData.get("sku") ?? "").trim();
  if (!cuentaId || !sku) throw new Error("Elegí la cuenta y escribí el SKU.");

  const params = new URLSearchParams({ cuentaId, sku });
  redirect(`/panel/publicar/clip?${params.toString()}`);
}

export async function subirClipAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const cuentaId = String(formData.get("cuentaId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const archivo = formData.get("archivo");
  if (!cuentaId || !itemId || !(archivo instanceof File) || archivo.size === 0) {
    throw new Error("Faltan datos para subir el Clip.");
  }

  validarArchivoClip(archivo.type, archivo.size);
  const token = await obtenerAccessTokenVigente(empresa.id, cuentaId);
  const buffer = await archivo.arrayBuffer();
  await subirClipItem(token, itemId, buffer, archivo.name, archivo.type);

  const params = new URLSearchParams({ cuentaId, itemId, clipSubido: "1" });
  redirect(`/panel/publicar/clip?${params.toString()}`);
}

export async function cambiarEstadoAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "modificar");

  const cuentaId = String(formData.get("cuentaId") ?? "");
  const itemId = String(formData.get("itemId") ?? "");
  const activar = formData.get("activar") === "1";
  if (!cuentaId || !itemId) throw new Error("Faltan datos.");

  await cambiarEstadoItemMl(empresa.id, cuentaId, itemId, activar);

  const params = new URLSearchParams({ cuentaId, itemId });
  redirect(`/panel/publicar/clip?${params.toString()}`);
}

export async function buscarItemConDatos(empresaId: string, cuentaId: string, cuentaIdExterna: string, sku: string) {
  return buscarItemPorSku(empresaId, { id: cuentaId, cuentaIdExterna }, sku);
}
