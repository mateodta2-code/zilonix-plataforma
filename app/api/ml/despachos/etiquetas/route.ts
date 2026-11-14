import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { EtiquetaNoImprimibleError, listarDespachosPendientes, listarDespachosYaImpresos, listarItemsPorEnvio, marcarEtiquetasImpresas, obtenerEtiquetasPdfPorEnvio } from "@/lib/ml/despachos";
import { prepararGuiaDeLote, unirPdfs } from "@/lib/pdf-etiqueta";

// Tarea 2.10 — "imprimes etiquetas de 10 pedidos en un clic": un form
// normal (no Server Action, que no puede devolver un PDF crudo) postea
// los shipment_id elegidos acá, y esto devuelve el PDF real de
// Mercado Libre directo al navegador — mismo criterio ya probado en el
// sistema actual: el token nunca lo ve ni lo maneja el usuario.
export async function POST(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  await requierePermiso(usuario.id, empresa.id, "ventas", "modificar");

  const formData = await request.formData();
  const seleccionados = formData.getAll("shipmentId").map(String);
  if (seleccionados.length === 0) return NextResponse.json({ error: "No se eligió ningún despacho." }, { status: 400 });

  // "Reimprimir en lote": mismo flujo, pero validando contra las ya
  // impresas (listarDespachosYaImpresos) — en los dos casos la lista
  // sale de la base, nunca de lo que mande el formulario.
  const reimprimir = formData.get("modo") === "reimprimir";
  const sticker = formData.get("formato") === "sticker";
  const candidatos = reimprimir ? await listarDespachosYaImpresos(empresa.id) : await listarDespachosPendientes(empresa.id);
  const elegidos = candidatos.filter((d) => seleccionados.includes(d.shipmentIdExterno));
  if (elegidos.length === 0) {
    return NextResponse.json({ error: reimprimir ? "Ninguna de las elegidas se puede reimprimir." : "Ninguno de los elegidos sigue pendiente." }, { status: 400 });
  }
  // Todos los pendientes deben ser de la MISMA cuenta de Mercado Libre
  // para armar una sola llamada a /shipment_labels — si hay de varias
  // cuentas, se imprime por cuenta (la pantalla ya agrupa así).
  const cuentaId = elegidos[0].cuentaMlId;
  if (elegidos.some((d) => d.cuentaMlId !== cuentaId)) {
    return NextResponse.json({ error: "Elige despachos de una sola cuenta de Mercado Libre a la vez." }, { status: 400 });
  }

  try {
    // Cada guía se pide por separado (ver obtenerEtiquetasPdfPorEnvio)
    // para saber con certeza de qué pedido es y ponerle SU franja
    // CONTENIDO — nunca adivinando el orden de las hojas de un lote.
    const shipmentIds = elegidos.map((d) => d.shipmentIdExterno);
    const [pdfs, itemsPorEnvio] = await Promise.all([obtenerEtiquetasPdfPorEnvio(empresa.id, cuentaId, shipmentIds), listarItemsPorEnvio(empresa.id, shipmentIds)]);
    await marcarEtiquetasImpresas(empresa.id, cuentaId, shipmentIds);

    // Sin la hoja de lista de despacho, con la franja y, en sticker,
    // recortada a 10x15 (prepararGuiaDeLote). Si eso falla con alguna
    // guía, va el PDF de Mercado Libre de ESA guía tal cual — nunca se
    // deja el lote sin imprimir por un extra.
    const guias = await Promise.all(
      pdfs.map(async (pdf, i) => {
        try {
          return await prepararGuiaDeLote(pdf, itemsPorEnvio.get(shipmentIds[i]) ?? [], sticker);
        } catch (errorFormato) {
          console.warn(`[api/ml/despachos/etiquetas] no se pudo ajustar la guía del envío ${shipmentIds[i]}, va la de Mercado Libre tal cual:`, errorFormato instanceof Error ? errorFormato.message : String(errorFormato));
          return pdf;
        }
      })
    );
    const cuerpo = guias.length === 1 ? guias[0] : await unirPdfs(guias);
    return new NextResponse(cuerpo, { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename=etiquetas${sticker ? "-sticker" : ""}.pdf` } });
  } catch (error) {
    if (error instanceof EtiquetaNoImprimibleError) return NextResponse.json({ error: error.message }, { status: 409 });
    // Nunca error.message crudo al cliente (puede traer el texto real
    // de la respuesta de Mercado Libre) — mismo criterio que
    // /api/ml/despachos/etiqueta: mensaje fijo afuera, el detalle real
    // solo en el log del servidor.
    console.warn("[api/ml/despachos/etiquetas] no se pudo imprimir el lote:", error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "No se pudieron obtener las guías de Mercado Libre." }, { status: 502 });
  }
}
