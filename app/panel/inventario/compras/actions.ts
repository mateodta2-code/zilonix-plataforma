"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { actualizarDatosCompra, anularOrdenCompra, crearOrdenCompra, registrarCompra, registrarRecepcion } from "@/lib/inventario/compras";
import { GastoInvalidoError } from "@/lib/finanzas/gastos";
import { marcarOrdenCompraPagada, OrdenCompraNoEncontradaError } from "@/lib/finanzas/por-pagar-db";
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

function datosCompraDe(formData: FormData) {
  return {
    fechaCompra: textoDe(formData.get("fechaCompra")),
    formaPago: textoDe(formData.get("formaPago")),
    plataforma: textoDe(formData.get("plataforma")),
    ordenPlataforma: textoDe(formData.get("ordenPlataforma")),
    linkCompra: textoDe(formData.get("linkCompra")),
    entregaEstimada: textoDe(formData.get("entregaEstimada")),
  };
}

// Registro de compras (27-nov): una fila = un producto. «productoModo»
// dice si se eligió un SKU existente o se crea el producto con su SKU
// (sugerido al azar y editable en el formulario).
export async function registrarCompraAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const nuevo = String(formData.get("productoModo") ?? "") === "nuevo";
  let orden;
  try {
    orden = await registrarCompra(empresaId, usuarioId, {
      producto: nuevo
        ? { nuevo: { codigo: String(formData.get("skuNuevo") ?? ""), nombre: String(formData.get("nombreNuevo") ?? "") } }
        : { skuId: String(formData.get("skuId") ?? "") },
      cantidad: enteroDe(formData.get("cantidad")),
      costoUnitario: textoDe(formData.get("valorUnidad")),
      bodegaDestinoId: String(formData.get("bodegaDestinoId") ?? ""),
      terceroId: textoDe(formData.get("terceroId")),
      nota: textoDe(formData.get("nota")),
      compra: datosCompraDe(formData),
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", `Compra registrada (OC-${orden.numero}).`));
}

export async function actualizarDatosCompraAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const ordenCompraId = String(formData.get("ordenCompraId") ?? "");
  const ruta = `${RUTA}/${encodeURIComponent(ordenCompraId)}`;
  try {
    await actualizarDatosCompra(empresaId, usuarioId, ordenCompraId, datosCompraDe(formData));
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(ruta, "error", mensaje));
  }
  redirect(conAviso(ruta, "ok", "Datos de la compra guardados."));
}

// «Liquidado»: la misma marca de pago que Finanzas → Por pagar (fecha y
// medio), con su mismo permiso (finanzas.modificar, también adentro).
export async function marcarLiquidadoAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  const ordenCompraId = String(formData.get("ordenCompraId") ?? "");
  const ruta = `${RUTA}/${encodeURIComponent(ordenCompraId)}`;
  try {
    await marcarOrdenCompraPagada({
      empresaId,
      usuarioId,
      ordenId: ordenCompraId,
      fechaPago: String(formData.get("fechaPago") ?? ""),
      medioPago: String(formData.get("medioPago") ?? ""),
    });
  } catch (error) {
    if (error instanceof GastoInvalidoError) redirect(conAviso(ruta, "error", error.message));
    if (error instanceof OrdenCompraNoEncontradaError) redirect(conAviso(ruta, "error", "Esa orden ya estaba liquidada o está anulada."));
    throw error;
  }
  redirect(conAviso(ruta, "ok", "Compra marcada como liquidada."));
}
