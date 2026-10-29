"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { buscarItemPorSku } from "@/lib/ml/clip";
import { cambiarEstadoItemMl } from "@/lib/ml/estado-item";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

// Code review de Pablo (pendiente del PR #276) — buscarItemAction y
// cambiarEstadoAction son las únicas 2 acciones reales del sub-flujo
// de Clip; ninguna de las dos chequeaba CLIP_HABILITADO todavía (solo
// la PÁGINA y la ruta de subida lo hacían) — alguien con el link
// directo de un <form> viejo (o un POST armado a mano) podía seguir
// buscando ítems o pausando/activando publicaciones aunque la bandera
// estuviera apagada. Mismo default seguro que el resto: oculto si
// falta o es distinta de "true". Nunca se llega a mirar sesión/
// permiso/Mercado Libre si la bandera está apagada.
function siClipDeshabilitadoVolverAlPanel(): void {
  if (process.env.CLIP_HABILITADO !== "true") redirect("/panel/publicar");
}

// Parte 2 (página única, estructura de Zilonix OS), punto 9 —
// "checkboxes de 'Cuentas donde buscar el SKU', botón 'Buscar SKU en
// las cuentas elegidas'": antes esto buscaba en UNA sola cuenta (un
// <select>); ahora recibe varias (formData.getAll, un checkbox por
// cuenta con el mismo name="cuentaId") y prueba cada una en orden
// hasta encontrar la primera con ese SKU — nunca llama 2 veces a la
// misma cuenta, nunca sigue buscando después de la primera que
// encuentra algo (serían resultados ambiguos: "¿cuál de las dos es la
// real?", innecesario para lo que esto resuelve).
export async function buscarItemAction(formData: FormData): Promise<void> {
  siClipDeshabilitadoVolverAlPanel();

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");

  const cuentaIds = formData.getAll("cuentaId").map(String).filter(Boolean);
  const sku = String(formData.get("sku") ?? "").trim();
  if (cuentaIds.length === 0 || !sku) throw new Error("Elegí al menos una cuenta y escribí el SKU.");

  const cuentas = await listarCuentasConectadas(empresa.id);
  for (const cuentaId of cuentaIds) {
    const cuenta = cuentas.find((c) => c.id === cuentaId && !c.desconectadaTs);
    if (!cuenta) continue;
    const item = await buscarItemPorSku(empresa.id, { id: cuenta.id, cuentaIdExterna: cuenta.cuentaIdExterna }, sku);
    if (item) {
      const params = new URLSearchParams({ cuentaId: cuenta.id, sku });
      redirect(`/panel/publicar?${params.toString()}#clip`);
    }
  }

  // Ninguna de las cuentas elegidas tenía ese SKU — mismo criterio de
  // siempre: nunca se adivina ni se pega a la primera cuenta a ciegas,
  // la página muestra "no se encontró" con el SKU tal cual se buscó.
  const params = new URLSearchParams({ sku });
  redirect(`/panel/publicar?${params.toString()}#clip`);
}

// Tarea 2.11 — subirClipAction (Server Action) se eliminó de acá: el
// límite global de next.config.mjs (bodySizeLimit: "6mb") rechazaba
// cualquier video real (Mercado Libre permite hasta 280MB) antes de
// llegar a validarArchivoClip. La subida ahora es un <form> normal que
// postea a app/api/ml/clip/route.ts (Route Handler, sin ese tope).

export async function cambiarEstadoAction(formData: FormData): Promise<void> {
  siClipDeshabilitadoVolverAlPanel();

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
  redirect(`/panel/publicar?${params.toString()}#clip`);
}
