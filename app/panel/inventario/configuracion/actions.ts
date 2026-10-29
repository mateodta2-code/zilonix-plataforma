"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { guardarConfiguracionInventario, type ReglaUltimaUnidad } from "@/lib/inventario/configuracion";
import { conAviso, enteroDe, mensajeParaPersona, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";
import { sincronizarStockMlEmpresa } from "@/lib/trabajos/sincronizarStockMl";

const RUTA = "/panel/inventario/configuracion";

// "autorizar" y no "modificar": esto decide si Seller empieza a
// escribir el stock en Mercado Libre y a reservar pedidos reales.
export async function guardarConfiguracionInventarioAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "autorizar");

  try {
    await guardarConfiguracionInventario(empresaId, usuarioId, {
      reglaUltimaUnidad: String(formData.get("reglaUltimaUnidad") ?? "") as ReglaUltimaUnidad,
      umbralUltimaUnidad: enteroDe(formData.get("umbralUltimaUnidad")),
      bufferMl: enteroDe(formData.get("bufferMl")),
      syncMlActivo: formData.get("syncMlActivo") === "on",
      reservarPedidos: formData.get("reservarPedidos") === "on",
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", "Configuración guardada."));
}

export async function sincronizarStockAhoraAction() {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "autorizar");

  const r = await sincronizarStockMlEmpresa(empresaId, { ignorarEspera: true, usuarioId });
  if (r.estado === "apagado") redirect(conAviso(RUTA, "error", "El envío de stock a Mercado Libre está apagado."));
  const mensaje = `${r.skus} SKU revisados: ${r.enviadas} publicación(es) actualizadas, ${r.omitidas} omitidas, ${r.fallidas} con error.${
    r.estado === "cortado_por_limite" ? " Mercado Libre pidió esperar: lo que faltó sale en la próxima corrida." : ""
  }`;
  redirect(conAviso(RUTA, r.fallidas > 0 ? "error" : "ok", mensaje));
}
