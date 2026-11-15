import { NextRequest, NextResponse } from "next/server";
import { evaluarAccesoSuperadmin, RUTA_LOGIN_SUPERADMIN } from "@/lib/superadmin";
import { NOMBRE_COOKIE_SUPERADMIN, firmarCookieSuperadmin, opcionesCookieSuperadmin } from "@/lib/superadmin-sesion";

// Único lugar donde se EMITE la cookie "zx_superadmin" (una página no
// puede escribir cookies). Repite los chequeos de entrada completos
// antes de firmar; sin ellos no emite nada.
export async function GET(req: NextRequest) {
  const acceso = await evaluarAccesoSuperadmin();
  if (!acceso.ok) {
    const destino = new URL(acceso.motivo === "sin-sesion" ? RUTA_LOGIN_SUPERADMIN : `${RUTA_LOGIN_SUPERADMIN}?motivo=${acceso.motivo}`, req.url);
    return NextResponse.redirect(destino);
  }
  const valor = await firmarCookieSuperadmin(acceso.clerkUserId, Date.now(), process.env.SUPERADMIN_SESION_SECRETO as string);
  const respuesta = NextResponse.redirect(new URL("/superadmin", req.url));
  respuesta.cookies.set(NOMBRE_COOKIE_SUPERADMIN, valor, opcionesCookieSuperadmin());
  return respuesta;
}
