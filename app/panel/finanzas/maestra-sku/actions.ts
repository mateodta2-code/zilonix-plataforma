"use server";

import { redirect } from "next/navigation";
import { guardarCostoSku, leerCostoSku, normalizarSkuCodigo, SkuCodigoInvalidoError } from "@/lib/costos-sku";
import { conMensaje, usuarioYEmpresaActiva } from "@/lib/finanzas/contexto-accion";
import { MontoInvalidoError } from "@/lib/finanzas/montos";
import { leerMonto } from "@/lib/importar-archivo";
import { requierePermiso } from "@/lib/permisos";
import { TerceroNoEncontradoError } from "@/lib/terceros";

// Issue #128 (Z-FIN-06) — editar una fila de la tabla maestra en
// pantalla. A diferencia del archivo, acá la persona ve el valor
// guardado: un campo vacío lo vacía (costo vacío = sin costo; packing
// vacío = usa el del proveedor). lib/costos-sku.ts aplica las reglas de
// ceros y deja el rastro en `auditoria`.

const CAMPOS_MONTO = [
  ["costo", "Costo"],
  ["empaque", "Packing propio"],
  ["envioAgencia", "Envío agencia"],
  ["precioMinimoUnidad", "Precio mínimo x1"],
  ["precioMinimoComboX2", "Precio mínimo x2"],
  ["precioMinimoComboX3", "Precio mínimo x3"],
  ["precioVenta", "Precio de venta"],
] as const;

export async function guardarFilaMaestraAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "finanzas", "modificar");

  const skuTexto = String(formData.get("sku") ?? "");
  const esNueva = formData.get("nueva") === "1";
  const volverAlFormulario = `/panel/finanzas/maestra-sku/editar${esNueva ? "" : `?sku=${encodeURIComponent(skuTexto)}`}`;

  let destino: string;
  try {
    const sku = normalizarSkuCodigo(skuTexto);
    if (esNueva && (await leerCostoSku(empresaId, sku))) {
      redirect(conMensaje(volverAlFormulario, "error", `El SKU ${sku} ya está en la tabla maestra: edítalo desde la lista.`));
    }

    const datos: Record<string, string | null> = {};
    for (const [campo, etiqueta] of CAMPOS_MONTO) {
      const leido = leerMonto({ tipo: "texto", valor: String(formData.get(campo) ?? "") });
      if (leido.tipo === "error") throw new MontoInvalidoError(etiqueta);
      datos[campo] = leido.tipo === "monto" ? leido.valor : null;
    }
    const nombreProducto = String(formData.get("nombreProducto") ?? "").trim().slice(0, 300) || null;
    const terceroId = String(formData.get("terceroId") ?? "") || null;

    await guardarCostoSku({ empresaId, usuarioId, skuCodigo: sku, datos: { ...datos, nombreProducto, terceroId }, fuente: "manual" });
    destino = conMensaje("/panel/finanzas/maestra-sku", "ok", `SKU ${sku} guardado.`);
  } catch (error) {
    if (error instanceof MontoInvalidoError || error instanceof SkuCodigoInvalidoError || error instanceof TerceroNoEncontradoError) {
      destino = conMensaje(volverAlFormulario, "error", error.message);
    } else {
      throw error;
    }
  }
  redirect(destino);
}
