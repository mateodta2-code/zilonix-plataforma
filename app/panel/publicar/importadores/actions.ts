"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { buscarItemPorSku } from "@/lib/ml/clip";
import { idItemDesdeLinkMl } from "../formulario-logica";

async function empresaActivaDe(usuarioId: string) {
  const propias = await listarEmpresasDeUsuario(usuarioId);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) throw new Error("No se encontró tu empresa activa.");
  return empresa;
}

// Parte 3, punto A.1 — "Importar por SKU propio": mismo patrón que
// buscarItemAction (clip/actions.ts) — varias cuentas elegidas con
// checkbox, se prueba cada una en orden hasta encontrar la primera con
// ese SKU, nunca sigue buscando después de la primera que encuentra
// algo. A diferencia de Clip, el resultado NO se usa para un sub-flujo
// aparte: vuelve a /panel/publicar con ?importarItemId/importarCuentaId,
// que page.tsx resuelve con importarItemCompleto (mismo contrato que
// usa también el importador por link, más abajo — una sola forma de
// hidratar el formulario sin importar de cuál de los dos vino).
export async function buscarImportacionPorSkuAction(formData: FormData): Promise<void> {
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
      const params = new URLSearchParams({ importarItemId: item.itemId, importarCuentaId: cuenta.id, importarOrigen: "sku" });
      redirect(`/panel/publicar?${params.toString()}#importar`);
    }
  }

  // Ninguna de las cuentas elegidas tenía ese SKU — mismo criterio que
  // Clip: nunca se adivina, la UI muestra "no se encontró" con el SKU
  // tal cual se buscó.
  const params = new URLSearchParams({ importarSkuNoEncontrado: sku });
  redirect(`/panel/publicar?${params.toString()}#importar`);
}

// Parte 3, punto A.2 — "Importar desde un link": el texto pegado se
// interpreta con idItemDesdeLinkMl (formulario-logica.ts, puro, sin
// llamar a nada) y recién con ese id ya validado se pide el ítem por la
// API OFICIAL, con el token de la PRIMERA cuenta conectada de la
// empresa — nunca se scrapea la página del link (prohibido, ver
// CLAUDE.md: "server-side scraping of ML is prohibited"). Si el link
// no trae ningún id reconocible, o la empresa no tiene ninguna cuenta
// conectada todavía, se avisa ANTES de intentar nada contra Mercado
// Libre.
export async function buscarImportacionPorLinkAction(formData: FormData): Promise<void> {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) redirect("/sign-in");
  const empresa = await empresaActivaDe(usuario.id);
  await requierePermiso(usuario.id, empresa.id, "inventario", "consultar");

  const link = String(formData.get("link") ?? "").trim();
  const itemId = idItemDesdeLinkMl(link);
  if (!itemId) {
    redirect(`/panel/publicar?importarLinkError=formato#importar`);
  }

  const cuentas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const cuenta = cuentas[0];
  if (!cuenta) {
    redirect(`/panel/publicar?importarLinkError=sin_cuenta#importar`);
  }

  // La verificación real de "¿Mercado Libre nos deja traer este ítem?"
  // (403/404 típico de una publicación ajena) pasa en page.tsx, al
  // llamar importarItemCompleto — acá solo se resuelve el id y la
  // cuenta con la que se va a intentar.
  const params = new URLSearchParams({ importarItemId: itemId, importarCuentaId: cuenta.id, importarOrigen: "link" });
  redirect(`/panel/publicar?${params.toString()}#importar`);
}
