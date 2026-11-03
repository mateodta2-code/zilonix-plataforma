import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { calcularCodeChallenge, construirUrlAutorizacion, generarCodeVerifier, generarState } from "@/lib/canva/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/canva/pkce-cookie";
import { resolverSesionYEmpresa, respuestaSiSinPermiso } from "../_ayudantes";

// Cada usuario conecta SU PROPIA cuenta de Canva — mismo mecanismo PKCE
// que /api/ml/conectar, verifier/state en cookies httpOnly de corta
// vida (10 min, de sobra para autorizar en Canva).
export async function GET() {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  try {
    const codeVerifier = generarCodeVerifier();
    const codeChallenge = calcularCodeChallenge(codeVerifier);
    const state = generarState();
    const redirectUri = `${urlPublicaBase()}/api/canva/callback`;
    const urlAutorizacion = construirUrlAutorizacion(redirectUri, codeChallenge, state);

    const respuesta = NextResponse.redirect(urlAutorizacion);
    const opcionesCookie = {
      httpOnly: true,
      secure: true,
      sameSite: "lax" as const,
      maxAge: 600,
      path: "/api/canva",
    };
    respuesta.cookies.set(NOMBRE_COOKIE_VERIFIER, codeVerifier, opcionesCookie);
    respuesta.cookies.set(NOMBRE_COOKIE_STATE, state, opcionesCookie);
    return respuesta;
  } catch (error) {
    // Nunca el error real tal cual (puede venir de requerirVariable con
    // detalles del entorno) — a diferencia de /api/canva/callback, acá
    // ni siquiera se llegó a pedir nada a Canva.
    console.error("[api/canva/conectar] no se pudo iniciar la conexión:", error instanceof Error ? error.name : String(error));
    return NextResponse.redirect(`${urlPublicaBase()}/panel/publicar?canva=error&codigo=error_desconocido`);
  }
}
