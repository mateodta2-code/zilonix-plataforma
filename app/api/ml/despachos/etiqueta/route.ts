import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { EtiquetaNoImprimibleError, marcarEtiquetasImpresas, marcarGuiaVista, obtenerDespachoParaGuia, obtenerEtiquetasPdf } from "@/lib/ml/despachos";
import { reescalarEtiquetaASticker } from "@/lib/pdf-etiqueta";

// Fase 1 de Despachos (issue "Despachos", punto 4) — "Ver guía" y "Ver
// guía (sticker)" de UNA sola tarjeta. Mismo PDF real de Mercado Libre
// que ya usa la impresión masiva (/api/ml/despachos/etiquetas, plural)
// — acá solo se pide un shipment_id a la vez, resuelto por despachoId
// (nunca por un shipmentId que mande el cliente, ver
// obtenerDespachoParaGuia). Solo "ventas"/"consultar" (punto 7 de la
// tarea: ver la guía no es la acción de "modificar" — esa es Marcar
// despachado, en app/panel/despachos/actions.ts) — pero sí marca
// guia_vista_ts (gate de Marcar despachado) y etiqueta_impresa_ts
// (mismo criterio que la impresión masiva: ya se obtuvo el PDF real,
// deja de aparecer como pendiente de imprimir).
export async function GET(request: NextRequest) {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.json({ error: "Sin sesión." }, { status: 401 });

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.json({ error: "Sin empresa activa." }, { status: 400 });

  await requierePermiso(usuario.id, empresa.id, "ventas", "consultar");

  const despachoId = request.nextUrl.searchParams.get("despachoId") ?? "";
  if (!despachoId) return NextResponse.json({ error: "Falta despachoId." }, { status: 400 });
  const formato = request.nextUrl.searchParams.get("formato") === "sticker" ? "sticker" : "normal";

  const despacho = await obtenerDespachoParaGuia(empresa.id, despachoId);
  if (!despacho) return NextResponse.json({ error: "Despacho no encontrado." }, { status: 404 });
  if (despacho.logisticType === "fulfillment") {
    return NextResponse.json({ error: "Un envío Full no tiene guía propia — lo despacha Mercado Libre." }, { status: 400 });
  }

  try {
    const pdf = await obtenerEtiquetasPdf(empresa.id, despacho.cuentaMlId, [despacho.shipmentIdExterno]);
    await marcarGuiaVista(empresa.id, despachoId);
    await marcarEtiquetasImpresas(empresa.id, despacho.cuentaMlId, [despacho.shipmentIdExterno]);
    const cuerpo = formato === "sticker" ? await reescalarEtiquetaASticker(pdf) : pdf;
    return new NextResponse(cuerpo, {
      headers: { "content-type": "application/pdf", "content-disposition": `inline; filename=guia-${despacho.shipmentIdExterno}${formato === "sticker" ? "-sticker" : ""}.pdf` },
    });
  } catch (error) {
    if (error instanceof EtiquetaNoImprimibleError) return NextResponse.json({ error: error.message }, { status: 409 });
    // Nunca error.message crudo al cliente (puede traer el texto real
    // de la respuesta de Mercado Libre, ver obtenerEtiquetasPdf) —
    // mismo criterio que app/api/ml/publicar/_ayudantes.ts
    // (respuestaDeErrorMl): mensaje fijo afuera, el detalle real solo
    // en el log del servidor.
    console.warn(`[api/ml/despachos/etiqueta] no se pudo obtener la guía del despacho ${despachoId}:`, error instanceof Error ? error.message : String(error));
    return NextResponse.json({ error: "No se pudo obtener la guía de Mercado Libre." }, { status: 502 });
  }
}
