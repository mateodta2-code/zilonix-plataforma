import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { aplicarReglaALote, type ReglaAplicable } from "@/lib/ml/promocionesPublicaciones";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Tarea "Promociones real" (Refs #295) — "Aplicar regla a las
// publicaciones": las 3 reglas de la maqueta aprobada (a. todas, b.
// máximo % a cargo del vendedor, c. tabla maestra de SKU). El piso de
// la tabla maestra (costos_sku) NUNCA se puede apagar en el motor
// (lib/ml/promociones.ts) — "todas" y "tabla-maestra" son el MISMO
// comportamiento de fondo, ver el comentario en
// lib/ml/promocionesPublicaciones.ts (cumpleRegla). Escribe de verdad
// contra Mercado Libre — permiso "ejecutar".
type Cuerpo = { cuentaId?: unknown; regla?: unknown; maximoPct?: unknown };

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
  const { cuentaId, regla, maximoPct } = cuerpo;
  if (cuentaId !== "todas" && (typeof cuentaId !== "string" || !PATRON_UUID.test(cuentaId))) {
    return NextResponse.json({ error: "Cuenta inválida." }, { status: 400 });
  }
  if (regla !== "todas" && regla !== "maximo" && regla !== "tabla-maestra") {
    return NextResponse.json({ error: "Regla inválida." }, { status: 400 });
  }

  let reglaAplicable: ReglaAplicable;
  if (regla === "maximo") {
    if (typeof maximoPct !== "number" || !Number.isFinite(maximoPct) || maximoPct <= 0 || maximoPct > 100) {
      return NextResponse.json({ error: "El máximo de descuento tiene que ser un porcentaje entre 1 y 100." }, { status: 400 });
    }
    reglaAplicable = { tipo: "maximo", maximoPct };
  } else {
    reglaAplicable = { tipo: regla };
  }

  const resumen = await aplicarReglaALote(empresa.id, usuario.id, cuentaId as string, reglaAplicable);
  return NextResponse.json(resumen);
}
