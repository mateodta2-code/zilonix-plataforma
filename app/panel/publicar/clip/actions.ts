"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { buscarItemPorSku } from "@/lib/ml/clip";
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

// Tarea 2.11 — subirClipAction (Server Action) se eliminó de acá: el
// límite global de next.config.mjs (bodySizeLimit: "6mb") rechazaba
// cualquier video real (Mercado Libre permite hasta 280MB) antes de
// llegar a validarArchivoClip. La subida ahora es un <form> normal que
// postea a app/api/ml/clip/route.ts (Route Handler, sin ese tope).

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
