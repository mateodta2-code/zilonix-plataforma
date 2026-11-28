"use server";

import { redirect } from "next/navigation";
import { requierePermiso } from "@/lib/permisos";
import { crearOrdenCompra } from "@/lib/inventario/compras";
import { listarBodegas } from "@/lib/inventario/bodegas";
import { guardarEntregaSku, guardarReglasProyeccion } from "@/lib/inventario/proyeccion-datos";
import { RUTAS_COMPRA, type RutaCompra, type VentanaDias } from "@/lib/inventario/proyeccion";
import { ConfiguracionInventarioInvalidaError } from "@/lib/inventario/configuracion";
import { conAviso, enteroDe, mensajeParaPersona, usuarioYEmpresaActiva } from "@/lib/inventario/sesion";

const RUTA = "/panel/inventario/proyeccion";
const MAXIMO_LINEAS_PLAN = 200;

// Las reglas y los días de entrega no mueven stock ni escriben en
// Mercado Libre: solo cambian cómo se calcula la proyección, por eso
// piden "modificar" y no "autorizar".
export async function guardarReglasProyeccionAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  try {
    await guardarReglasProyeccion(empresaId, usuarioId, {
      coberturaDias: enteroDe(formData.get("coberturaDias")),
      colchonPorcentaje: enteroDe(formData.get("colchonPorcentaje")),
      ventanaDias: enteroDe(formData.get("ventanaDias")) as VentanaDias,
      leadPorRuta: {
        nacional: enteroDe(formData.get("leadNacional")),
        plataforma: enteroDe(formData.get("leadPlataforma")),
        avion: enteroDe(formData.get("leadAvion")),
      },
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(`${RUTA}?vista=reglas`, "error", mensaje));
  }
  redirect(conAviso(`${RUTA}?vista=reglas`, "ok", "Reglas guardadas. La proyección ya las usa."));
}

export async function guardarEntregaSkuAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "modificar");

  const texto = String(formData.get("leadTimeDias") ?? "").trim();
  const ruta = String(formData.get("ruta") ?? "") as RutaCompra;
  const vuelta = String(formData.get("vuelta") ?? "") === "reglas" ? `${RUTA}?vista=reglas` : RUTA;
  try {
    await guardarEntregaSku(empresaId, usuarioId, {
      skuId: String(formData.get("skuId") ?? ""),
      ruta,
      // Vacío = usar los días de la forma de compra.
      leadTimeDias: texto === "" ? null : enteroDe(formData.get("leadTimeDias")),
    });
  } catch (error) {
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(vuelta, "error", mensaje));
  }
  redirect(conAviso(vuelta, "ok", "Entrega guardada."));
}

// Pasa una forma de compra del plan a una orden de compra real (la misma
// de /panel/inventario/compras), con las cantidades que la persona dejó
// en el formulario. Llega a la bodega principal; ahí se puede cambiar
// desde la orden. Pide "crear", igual que crear una OC a mano.
export async function crearOrdenDesdePlanAction(formData: FormData) {
  const { usuarioId, empresaId } = await usuarioYEmpresaActiva();
  await requierePermiso(usuarioId, empresaId, "inventario", "crear");

  const ruta = String(formData.get("ruta") ?? "") as RutaCompra;
  const vuelta = `${RUTA}?vista=plan`;
  if (!RUTAS_COMPRA.includes(ruta)) redirect(conAviso(vuelta, "error", "Esa forma de compra no existe."));

  const lineas: { skuId: string; cantidad: number }[] = [];
  for (let i = 0; i < MAXIMO_LINEAS_PLAN; i++) {
    const skuId = String(formData.get(`sku_${i}`) ?? "").trim();
    if (!skuId) continue;
    const cantidad = enteroDe(formData.get(`cantidad_${i}`));
    // 0 o vacío = no comprar este producto en esta orden.
    if (!Number.isFinite(cantidad) || cantidad <= 0) continue;
    lineas.push({ skuId, cantidad });
  }
  if (lineas.length === 0) redirect(conAviso(vuelta, "error", "No hay cantidades para pedir."));

  const bodegas = await listarBodegas(empresaId, { soloActivas: true });
  const destino = bodegas.find((b) => b.esPrincipal) ?? bodegas.find((b) => b.tipo !== "fulfillment_ml");
  if (!destino) redirect(conAviso(vuelta, "error", "Primero crea una bodega para recibir la compra."));

  let orden;
  try {
    orden = await crearOrdenCompra(empresaId, usuarioId, {
      terceroId: null,
      bodegaDestinoId: destino.id,
      nota: `Plan de compra (proyección de inventarios) · ${ruta}`,
      lineas,
    });
  } catch (error) {
    if (error instanceof ConfiguracionInventarioInvalidaError) redirect(conAviso(vuelta, "error", error.message));
    const mensaje = mensajeParaPersona(error);
    if (!mensaje) throw error;
    redirect(conAviso(vuelta, "error", mensaje));
  }
  redirect(conAviso(`/panel/inventario/compras/${orden.id}`, "ok", `OC-${orden.numero} creada desde el plan de compra.`));
}
