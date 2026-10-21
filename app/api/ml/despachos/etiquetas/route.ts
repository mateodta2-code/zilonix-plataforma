import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { listarDespachosPendientes, obtenerEtiquetasPdf, marcarEtiquetasImpresas, EtiquetaNoImprimibleError } from "@/lib/ml/despachos";

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

  // Todos los pendientes deben ser de la MISMA cuenta de Mercado Libre
  // para armar una sola llamada a /shipment_labels — si hay de varias
  // cuentas, se imprime por cuenta (la pantalla ya agrupa así).
  const pendientes = await listarDespachosPendientes(empresa.id);
  const elegidos = pendientes.filter((d) => seleccionados.includes(d.shipmentIdExterno));
  if (elegidos.length === 0) return NextResponse.json({ error: "Ninguno de los elegidos sigue pendiente." }, { status: 400 });
  const cuentaId = elegidos[0].cuentaMlId;
  if (elegidos.some((d) => d.cuentaMlId !== cuentaId)) {
    return NextResponse.json({ error: "Elige despachos de una sola cuenta de Mercado Libre a la vez." }, { status: 400 });
  }

  try {
    const pdf = await obtenerEtiquetasPdf(
      empresa.id,
      cuentaId,
      elegidos.map((d) => d.shipmentIdExterno)
    );
    await marcarEtiquetasImpresas(
      empresa.id,
      cuentaId,
      elegidos.map((d) => d.shipmentIdExterno)
    );
    return new NextResponse(pdf, { headers: { "content-type": "application/pdf", "content-disposition": "inline; filename=etiquetas.pdf" } });
  } catch (error) {
    if (error instanceof EtiquetaNoImprimibleError) return NextResponse.json({ error: error.message }, { status: 409 });
    const mensaje = error instanceof Error ? error.message : "Error desconocido.";
    return NextResponse.json({ error: mensaje }, { status: 502 });
  }
}
