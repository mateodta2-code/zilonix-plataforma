import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { participarEnPublicacionDirecto } from "@/lib/ml/promocionesPublicaciones";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Tarea "Promociones real" (Refs #295) — "Participar"/"Modificar" de un
// click, con la ventana de confirmación como único paso humano (pedido
// explícito de Mateo en la maqueta aprobada: nunca la cola
// "aprobar → Lanzar aprobadas" del módulo viejo). Mismo permiso que
// /participando/salir — esto SÍ escribe de verdad contra Mercado
// Libre, nunca "aprobar".
type Cuerpo = { cuentaId?: unknown; itemId?: unknown; promotionIdMl?: unknown; tipoPromocion?: unknown; precioElegido?: unknown };

export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "ejecutar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  let cuerpo: Cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  const { cuentaId, itemId, promotionIdMl, tipoPromocion, precioElegido } = cuerpo;
  if (typeof cuentaId !== "string" || !PATRON_UUID.test(cuentaId)) return NextResponse.json({ error: "Falta la cuenta." }, { status: 400 });
  if (typeof itemId !== "string" || !itemId) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });
  if (typeof tipoPromocion !== "string" || !tipoPromocion) return NextResponse.json({ error: "Falta el tipo de promoción." }, { status: 400 });
  if (promotionIdMl !== null && promotionIdMl !== undefined && typeof promotionIdMl !== "string") {
    return NextResponse.json({ error: "Falta el identificador de la promoción." }, { status: 400 });
  }
  if (precioElegido !== undefined && (typeof precioElegido !== "number" || !Number.isFinite(precioElegido))) {
    return NextResponse.json({ error: "El precio elegido no es válido." }, { status: 400 });
  }

  const resultado = await participarEnPublicacionDirecto(
    empresa.id,
    usuario.id,
    cuentaId,
    itemId,
    typeof promotionIdMl === "string" ? promotionIdMl : null,
    tipoPromocion,
    precioElegido as number | undefined
  );

  // Mismo criterio que /acciones (punto 4, PR #307) — un rechazo (de
  // validación o de Mercado Libre) SIEMPRE queda visible con su motivo
  // real, nunca se pierde detrás de un 4xx/5xx genérico: HTTP 200
  // siempre que el servidor terminó de procesar el pedido, con
  // `ok`/`estado`/`error` adentro para que el cliente muestre el
  // motivo exacto.
  return NextResponse.json(resultado);
}
