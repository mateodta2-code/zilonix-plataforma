"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { anularDevolucion, recibirDevolucion, registrarDevolucion, type TiendaDevolucion } from "@/lib/inventario/devoluciones";
import { traerDevolucionesMl } from "@/lib/inventario/devoluciones-ml";
import { conAviso, enteroDe, mensajeParaPersona, textoDe, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";

// Productos → Devoluciones (28-nov). Todo pide inventario.crear (mueve o
// prepara stock), también adentro de cada acción del servicio.
const RUTA = "/panel/inventario/devoluciones";

export async function traerDevolucionesMlAction() {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");
  let r;
  try {
    r = await traerDevolucionesMl(empresaId, usuarioId);
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  const partes = [
    r.nuevas === 0 ? "No hay devoluciones nuevas por llegar." : `${r.nuevas} ${r.nuevas === 1 ? "devolución nueva" : "devoluciones nuevas"} por llegar.`,
    r.actualizadas > 0 ? `${r.actualizadas} con su envío actualizado.` : "",
    r.sinVenta > 0 ? `${r.sinVenta} sin la venta en Zilonix: elige el SKU al recibirla.` : "",
    r.cuentasSinRevisar.length > 0 ? `No se pudieron leer: ${r.cuentasSinRevisar.join(", ")}.` : "",
    r.truncado ? "Mercado Libre tiene más reclamos de los que se leyeron: vuelve a traer más tarde." : "",
  ].filter(Boolean);
  redirect(conAviso(RUTA, "ok", partes.join(" ")));
}

// «Tienda» llega como «ml:<id>», «falabella:<id>» u «otra» (+ texto).
function tiendaDe(formData: FormData): TiendaDevolucion {
  const valor = String(formData.get("tienda") ?? "");
  if (valor.startsWith("ml:")) return { cuentaMlId: valor.slice(3) };
  if (valor.startsWith("falabella:")) return { cuentaFalabellaId: valor.slice(10) };
  return { otra: String(formData.get("tiendaOtra") ?? "") };
}

export async function registrarDevolucionAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");
  try {
    await registrarDevolucion(empresaId, usuarioId, {
      fecha: String(formData.get("fecha") ?? ""),
      tienda: tiendaDe(formData),
      skuId: String(formData.get("skuId") ?? ""),
      cantidad: enteroDe(formData.get("cantidad")),
      pedidoIdExterno: textoDe(formData.get("pedido")),
      nota: textoDe(formData.get("nota")),
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", "Devolución registrada: queda por llegar."));
}

export async function recibirDevolucionAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");
  const condicion = String(formData.get("condicion") ?? "") === "averiado" ? "averiado" : String(formData.get("condicion") ?? "") === "bueno" ? "bueno" : ("" as "bueno");
  try {
    await recibirDevolucion(empresaId, usuarioId, String(formData.get("id") ?? ""), {
      condicion,
      bodegaId: textoDe(formData.get("bodegaId")),
      skuId: textoDe(formData.get("skuId")),
      cantidad: enteroDe(formData.get("cantidad")),
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", condicion === "averiado" ? "Recibida averiada: entró a la bodega Averiados." : "Recibida en buen estado: el stock ya subió."));
}

export async function anularDevolucionAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "anular");
  try {
    await anularDevolucion(empresaId, usuarioId, String(formData.get("id") ?? ""));
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", "Devolución anulada."));
}
