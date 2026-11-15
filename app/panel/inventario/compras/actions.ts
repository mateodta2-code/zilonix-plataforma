"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { anularOrdenCompra, crearOrdenCompra, registrarRecepcion } from "@/lib/inventario/compras";
import { conAviso, enteroDe, lineasDelFormulario, mensajeParaPersona, textoDe, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";

const RUTA = "/panel/inventario/compras";
const MAXIMO_LINEAS = 15;

export async function crearOrdenCompraAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const lineas = [];
  for (let i = 0; i < MAXIMO_LINEAS; i++) {
    const skuId = String(formData.get(`sku_${i}`) ?? "").trim();
    if (!skuId || !String(formData.get(`cantidad_${i}`) ?? "").trim()) continue;
    lineas.push({ skuId, cantidad: enteroDe(formData.get(`cantidad_${i}`)), costoUnitario: textoDe(formData.get(`costo_${i}`)) });
  }
  let orden;
  try {
    orden = await crearOrdenCompra(empresaId, usuarioId, {
      terceroId: textoDe(formData.get("terceroId")),
      bodegaDestinoId: String(formData.get("bodegaDestinoId") ?? ""),
      nota: textoDe(formData.get("nota")),
      lineas,
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(`${RUTA}/${orden.id}`, "ok", `OC-${orden.numero} creada.`));
}

export async function recibirOrdenCompraAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const ordenCompraId = String(formData.get("ordenCompraId") ?? "");
  const ruta = `${RUTA}/${encodeURIComponent(ordenCompraId)}`;
  let resultado;
  try {
    resultado = await registrarRecepcion(empresaId, usuarioId, {
      recepcionId: String(formData.get("recepcionId") ?? ""),
      ordenCompraId,
      bodegaId: String(formData.get("bodegaId") ?? ""),
      nota: textoDe(formData.get("nota")),
      lineas: lineasDelFormulario(formData, 200),
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(ruta, "error", mensaje));
  }
  redirect(conAviso(ruta, "ok", resultado.yaRegistrada ? "Esa recepción ya estaba registrada." : "Recepción registrada: el stock ya subió."));
}

export async function anularOrdenCompraAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "anular");

  const ordenCompraId = String(formData.get("ordenCompraId") ?? "");
  try {
    await anularOrdenCompra(empresaId, usuarioId, ordenCompraId);
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(`${RUTA}/${encodeURIComponent(ordenCompraId)}`, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", "Orden anulada."));
}
