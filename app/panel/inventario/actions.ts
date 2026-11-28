"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { aplicarMovimientos } from "@/lib/inventario/movimientos";
import { resolverAlerta } from "@/lib/inventario/alertas";
import { conAviso, enteroDe, mensajeParaPersona, textoDe, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";
import {
  DatosModificarInvalidosError,
  esUuidValido,
  listarHistorialProducto,
  parsearMovimientoModificar,
  type FilaHistorialProducto,
} from "@/lib/inventario/vista-inventario";
import { editarProducto, esErrorDeProducto, obtenerSkuParaEditar, validarNombreProducto } from "@/lib/inventario/crear-producto";
import { guardarCostoSku, leerCostoSku } from "@/lib/costos-sku";
import { validarMonto } from "@/lib/finanzas/montos";

const RUTA = "/panel/inventario";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// El formulario trae un id generado al pintarse: un doble clic manda el
// mismo y el segundo envío no mueve nada (clave de idempotencia).
function claveManual(formData: FormData): string {
  const id = String(formData.get("operacionId") ?? "");
  if (!UUID_RE.test(id)) redirect(conAviso(RUTA, "error", "El formulario está vencido: recarga la página."));
  return `manual:${id}`;
}

export async function ajustarStockAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const nota = textoDe(formData.get("nota"));
  if (!nota) redirect(conAviso(RUTA, "error", "Un ajuste necesita el motivo (conteo, daño, pérdida...)."));
  const claveIdempotencia = claveManual(formData);
  let resultado;
  try {
    resultado = await aplicarMovimientos(empresaId, {
      claveIdempotencia,
      origen: "manual",
      actor: { tipo: "persona", usuarioId },
      nota,
      lineas: [
        {
          tipo: "ajuste",
          bodegaId: String(formData.get("bodegaId") ?? ""),
          skuId: String(formData.get("skuId") ?? ""),
          cantidad: enteroDe(formData.get("cantidad")),
        },
      ],
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", resultado.aplicado ? "Ajuste registrado en el kardex." : "Ese ajuste ya estaba registrado."));
}

export async function trasladarStockAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const claveIdempotencia = claveManual(formData);
  let resultado;
  try {
    resultado = await aplicarMovimientos(empresaId, {
      claveIdempotencia,
      origen: "traslado",
      actor: { tipo: "persona", usuarioId },
      nota: textoDe(formData.get("nota")),
      lineas: [
        {
          tipo: "traslado",
          bodegaId: String(formData.get("bodegaOrigenId") ?? ""),
          bodegaDestinoId: String(formData.get("bodegaDestinoId") ?? ""),
          skuId: String(formData.get("skuId") ?? ""),
          cantidad: enteroDe(formData.get("cantidad")),
        },
      ],
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", resultado.aplicado ? "Traslado registrado." : "Ese traslado ya estaba registrado."));
}

export async function resolverAlertaAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const decision = formData.get("decision") === "aplicar" ? "aplicada" : "descartada";
  try {
    await resolverAlerta(empresaId, usuarioId, String(formData.get("alertaId") ?? ""), decision);
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(RUTA, "error", mensaje));
  }
  redirect(conAviso(RUTA, "ok", decision === "aplicada" ? "Marcado como aplicado." : "Regla no aplicada para ese SKU."));
}

// ---------- Emergentes de la tabla (Modificar e Historial) ----------
// Las llama un componente cliente: devuelven { ok, mensaje } en vez de
// redirect, para mostrar el aviso dentro del modal sin cerrarlo.

export type ResultadoModal = { ok: true; mensaje: string } | { ok: false; mensaje: string };

const SIN_PERMISO = "Tu rol no puede hacer este cambio.";

// Historial del producto en esa bodega. Solo lectura: inventario.consultar.
export async function historialProductoAction(
  skuId: string,
  bodegaId: string | null,
  pagina: number
): Promise<{ ok: true; filas: FilaHistorialProducto[]; hayMas: boolean } | { ok: false; mensaje: string }> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "consultar");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, mensaje: "Tu rol no puede ver el inventario." };
    throw error;
  }
  // Nada que no sea UUID llega a la base.
  if (!esUuidValido(skuId) || (bodegaId !== null && !esUuidValido(bodegaId))) return { ok: false, mensaje: "Ese producto no existe en tu empresa." };
  const paginaSegura = Number.isSafeInteger(pagina) && pagina >= 1 ? pagina : 1;
  const { filas, hayMas } = await listarHistorialProducto(empresaId, { skuId, bodegaId, pagina: paginaSegura });
  return { ok: true, filas, hayMas };
}

// Ingreso o salida desde «Modificar»: la única puerta sigue siendo
// aplicarMovimientos (nunca un UPDATE a mano), con la clave del
// operacionId del modal (un doble clic no duplica).
export async function moverStockProductoAction(formData: FormData): Promise<ResultadoModal> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, mensaje: SIN_PERMISO };
    throw error;
  }
  let datos;
  try {
    datos = parsearMovimientoModificar({
      tipo: formData.get("tipo"),
      skuId: formData.get("skuId"),
      bodegaId: formData.get("bodegaId"),
      cantidad: formData.get("cantidad"),
      nota: formData.get("nota"),
      operacionId: formData.get("operacionId"),
    });
  } catch (error) {
    if (error instanceof DatosModificarInvalidosError) return { ok: false, mensaje: error.message };
    throw error;
  }
  let resultado;
  try {
    resultado = await aplicarMovimientos(empresaId, {
      claveIdempotencia: `manual:${datos.operacionId}`,
      origen: "manual",
      actor: { tipo: "persona", usuarioId },
      nota: datos.nota,
      lineas: [{ tipo: datos.tipo, bodegaId: datos.bodegaId, skuId: datos.skuId, cantidad: datos.cantidad }],
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    return { ok: false, mensaje };
  }
  revalidatePath(RUTA);
  if (!resultado.aplicado) return { ok: true, mensaje: "Ese movimiento ya estaba registrado." };
  return { ok: true, mensaje: datos.tipo === "entrada" ? "Ingreso registrado en el kardex." : "Salida registrada en el kardex." };
}

// Nombre (inventario.modificar) y costo/precio (además
// finanzas.modificar, igual que la maestra de Finanzas). El código del
// SKU no se edita acá. Se valida todo antes de escribir nada.
export async function editarDatosProductoAction(formData: FormData): Promise<ResultadoModal> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "modificar");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, mensaje: SIN_PERMISO };
    throw error;
  }
  const sku = await obtenerSkuParaEditar(empresaId, String(formData.get("skuId") ?? ""));
  if (!sku) return { ok: false, mensaje: "Ese producto no existe en tu empresa." };

  let puedeCambiarCostos = false;
  try {
    await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");
    puedeCambiarCostos = true;
  } catch (error) {
    if (!(error instanceof SinPermisoError)) throw error;
  }

  try {
    // Un kit se administra en SKU (editarProducto lo rechaza): su nombre
    // no se cambia acá, solo su costo/precio.
    const nombre = sku.esKit ? sku.nombre : validarNombreProducto(String(formData.get("nombre") ?? ""));
    const tocaCostos = puedeCambiarCostos && formData.has("costo") && formData.has("precioVenta");
    const costo = tocaCostos ? validarMonto(String(formData.get("costo") ?? ""), "Costo inicial") : null;
    const precioVenta = tocaCostos ? validarMonto(String(formData.get("precioVenta") ?? ""), "Precio de venta") : null;

    const cambiaNombre = !sku.esKit && nombre !== sku.nombre;
    if (cambiaNombre) await editarProducto(empresaId, usuarioId, { skuId: sku.id, nombre });

    let cambiaCostos = false;
    if (tocaCostos) {
      const actual = await leerCostoSku(empresaId, sku.codigo);
      cambiaCostos = (actual?.costo ?? null) !== costo || (actual?.precioVenta ?? null) !== precioVenta;
      if (cambiaCostos) {
        await guardarCostoSku({ empresaId, usuarioId, skuCodigo: sku.codigo, datos: { nombreProducto: nombre, costo, precioVenta }, fuente: "manual" });
      }
    }
    if (!cambiaNombre && !cambiaCostos) return { ok: true, mensaje: "No había nada que cambiar." };
  } catch (error) {
    if (esErrorDeProducto(error)) return { ok: false, mensaje: error.message };
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    return { ok: false, mensaje };
  }
  revalidatePath(RUTA);
  return { ok: true, mensaje: "Producto actualizado." };
}
