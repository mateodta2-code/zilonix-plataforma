"use server";

import { randomUUID } from "crypto";
import { redirect } from "next/navigation";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { leerMonto, type FilaArchivo } from "@/lib/importar-archivo";
import { conAviso, enteroDe, mensajeParaPersona, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";
import { crearProducto, editarProducto, esErrorDeProducto, sugerirSkuAleatorio } from "@/lib/inventario/crear-producto";
import {
  CargaMasivaInvalidaError,
  confirmarCargaMasivaProductos,
  filasDeArchivo,
  filasDeTextoPegado,
  previsualizarCargaMasivaProductos,
  type ResultadoCargaMasiva,
  type VistaPreviaCarga,
} from "@/lib/inventario/carga-masiva-productos";

// Issue #280 — «Crear producto (SKU)». Cada acción revisa su permiso
// acá (crear / crear / modificar / crear / crear), además de la página.
const RUTA = "/panel/sku/crear";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Errores de la persona → aviso; cualquier otro sube tal cual.
function avisoDeError(error: unknown): string | null {
  if (esErrorDeProducto(error) || error instanceof CargaMasivaInvalidaError) return error.message;
  return mensajeParaPersona(error);
}

function montoDelFormulario(valor: FormDataEntryValue | null, campo: string): { ok: true; valor: string | null } | { ok: false; mensaje: string } {
  const texto = String(valor ?? "").trim();
  const leido = leerMonto(texto ? { tipo: "texto", valor: texto } : { tipo: "vacia" });
  if (leido.tipo === "error") return { ok: false, mensaje: `${campo}: ${leido.mensaje}` };
  return { ok: true, valor: leido.tipo === "monto" ? leido.valor : null };
}

export async function crearProductoAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const costo = montoDelFormulario(formData.get("costo"), "Costo inicial");
  if (!costo.ok) redirect(conAviso(RUTA, "error", costo.mensaje));
  const precio = montoDelFormulario(formData.get("precioVenta"), "Precio de venta");
  if (!precio.ok) redirect(conAviso(RUTA, "error", precio.mensaje));
  const stockTexto = String(formData.get("stockInicial") ?? "").trim();
  const stockInicial = stockTexto === "" ? 0 : enteroDe(stockTexto);

  let resultado;
  let mensajeError: string | null = null;
  try {
    resultado = await crearProducto(empresaId, usuarioId, {
      codigo: String(formData.get("sku") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      costo: costo.valor,
      precioVenta: precio.valor,
      stockInicial,
      bodegaId: stockInicial > 0 ? String(formData.get("bodegaId") ?? "") : null,
      operacionId: String(formData.get("operacionId") ?? ""),
    });
  } catch (error) {
    mensajeError = avisoDeError(error);
    if (!mensajeError) throw error;
  }
  if (mensajeError || !resultado) redirect(conAviso(RUTA, "error", mensajeError ?? "No se pudo crear el producto."));
  redirect(
    conAviso(
      RUTA,
      "ok",
      resultado.yaExistia
        ? `Ese producto ya estaba creado (${resultado.codigo}).`
        : `Producto ${resultado.codigo} creado${stockInicial > 0 ? ` con ${stockInicial} unidad(es) de inventario inicial` : ""}.`
    )
  );
}

export type SugerenciaSku = { ok: true; codigo: string } | { ok: false; mensaje: string };

// Solo lectura: no escribe nada, solo propone el siguiente código libre.
export async function sugerirSkuAleatorioAction(nombre: string): Promise<SugerenciaSku> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "crear");
  } catch (error) {
    if (error instanceof SinPermisoError) return { ok: false, mensaje: "Tu rol no puede crear SKU." };
    throw error;
  }
  const texto = String(nombre ?? "").trim().slice(0, 200);
  if (!texto) return { ok: false, mensaje: "Escribe primero el nombre del producto." };
  try {
    return { ok: true, codigo: await sugerirSkuAleatorio(empresaId, texto) };
  } catch (error) {
    const mensaje = avisoDeError(error);
    if (!mensaje) throw error;
    return { ok: false, mensaje };
  }
}

export async function editarProductoAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const skuId = String(formData.get("skuId") ?? "");
  const rutaEdicion = UUID_RE.test(skuId) ? `${RUTA}?editar=${skuId}` : RUTA;
  const codigo = formData.get("codigo");
  let resultado;
  let mensajeError: string | null = null;
  try {
    resultado = await editarProducto(empresaId, usuarioId, {
      skuId,
      nombre: String(formData.get("nombre") ?? ""),
      codigo: codigo === null ? null : String(codigo),
    });
  } catch (error) {
    mensajeError = avisoDeError(error);
    if (!mensajeError) throw error;
  }
  if (mensajeError || !resultado) redirect(conAviso(rutaEdicion, "error", mensajeError ?? "No se pudo guardar."));
  redirect(conAviso(RUTA, "ok", `Producto ${resultado.codigo} actualizado.`));
}

export type EstadoCargaMasiva =
  | { paso: "inicial" }
  | { paso: "error"; mensaje: string }
  | { paso: "revisar"; vista: VistaPreviaCarga; cargaId: string }
  | { paso: "confirmado"; resultado: ResultadoCargaMasiva };

// El texto pegado o el archivo llegan tal cual: el servidor los vuelve
// a leer siempre (en la vista previa y otra vez al confirmar).
async function filasDeLaCarga(formData: FormData): Promise<{ ok: true; filas: FilaArchivo[] } | { ok: false; mensaje: string }> {
  const archivo = formData.get("archivo");
  if (archivo instanceof File && archivo.size > 0) {
    return filasDeArchivo(archivo.name, Buffer.from(await archivo.arrayBuffer()));
  }
  const texto = String(formData.get("texto") ?? "");
  if (!texto.trim()) return { ok: false, mensaje: "Pega las líneas de productos o elige un archivo .csv o .xlsx." };
  return filasDeTextoPegado(texto);
}

export async function previsualizarCargaMasivaAction(formData: FormData): Promise<EstadoCargaMasiva> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "crear");
    const leidas = await filasDeLaCarga(formData);
    if (!leidas.ok) return { paso: "error", mensaje: leidas.mensaje };
    const vista = await previsualizarCargaMasivaProductos(empresaId, usuarioId, leidas.filas, String(formData.get("bodegaId") ?? ""));
    if (vista.rechazo) return { paso: "error", mensaje: vista.rechazo };
    return { paso: "revisar", vista, cargaId: randomUUID() };
  } catch (error) {
    if (error instanceof SinPermisoError) return { paso: "error", mensaje: "Tu rol no puede crear SKU." };
    const mensaje = avisoDeError(error);
    if (!mensaje) throw error;
    return { paso: "error", mensaje };
  }
}

export async function confirmarCargaMasivaAction(formData: FormData): Promise<EstadoCargaMasiva> {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  try {
    await requierePermiso(usuarioId, empresaId, "inventario", "crear");
    const leidas = await filasDeLaCarga(formData);
    if (!leidas.ok) return { paso: "error", mensaje: leidas.mensaje };
    const resultado = await confirmarCargaMasivaProductos(
      empresaId,
      usuarioId,
      leidas.filas,
      String(formData.get("bodegaId") ?? ""),
      String(formData.get("cargaId") ?? "")
    );
    return { paso: "confirmado", resultado };
  } catch (error) {
    if (error instanceof SinPermisoError) return { paso: "error", mensaje: "Tu rol no puede crear SKU." };
    const mensaje = avisoDeError(error);
    if (!mensaje) throw error;
    return { paso: "error", mensaje };
  }
}
