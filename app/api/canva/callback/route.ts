import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { guardarConexion } from "@/lib/canva/conexiones";
import { intercambiarCodigo } from "@/lib/canva/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/canva/pkce-cookie";
import { resolverSesionYEmpresa } from "../_ayudantes";

// Mismo chequeo con tiempo constante que /api/ml/callback (nunca
// "===" para comparar un secreto que viaja por URL).
function coincideState(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

export async function GET(request: NextRequest) {
  const base = urlPublicaBase();
  // Vuelve a Publicar (no a Configuración) — el botón "Conectar Canva"
  // vive ahí (ConectarCanva.tsx, arriba del todo en FormularioPublicar.tsx),
  // gateado por el mismo permiso "inventario" que ya usa esa pantalla —
  // a diferencia de Configuración, que exige el módulo "configuracion"
  // (un Auxiliar/Operador puede publicar sin tener ese permiso).
  const volver = (query: string) => {
    const respuesta = NextResponse.redirect(`${base}/panel/publicar?${query}`);
    respuesta.cookies.set(NOMBRE_COOKIE_VERIFIER, "", { path: "/api/canva", maxAge: 0 });
    respuesta.cookies.set(NOMBRE_COOKIE_STATE, "", { path: "/api/canva", maxAge: 0 });
    return respuesta;
  };

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return NextResponse.redirect(`${base}/sign-in`);
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "inventario", "crear");
  } catch (error) {
    if (error instanceof SinPermisoError) return volver("canva=error&codigo=sin_permiso");
    throw error;
  }

  const errorCanva = request.nextUrl.searchParams.get("error");
  if (errorCanva) return volver("canva=error&codigo=canva_rechazo");

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return volver("canva=error&codigo=canva_rechazo");

  const stateRecibido = request.nextUrl.searchParams.get("state");
  const stateEsperado = cookies().get(NOMBRE_COOKIE_STATE)?.value;
  if (!stateRecibido || !stateEsperado || !coincideState(stateRecibido, stateEsperado)) {
    return volver("canva=error&codigo=estado_vencido");
  }

  const codeVerifier = cookies().get(NOMBRE_COOKIE_VERIFIER)?.value;
  if (!codeVerifier) return volver("canva=error&codigo=estado_vencido");

  try {
    const redirectUri = `${base}/api/canva/callback`;
    const tokens = await intercambiarCodigo(code, redirectUri, codeVerifier);
    await guardarConexion(empresa.id, usuario.id, tokens);
    return volver("canva=conectado");
  } catch (error) {
    // Nunca el error real tal cual — a este punto ya se canjeó el code
    // por tokens reales, oauth.ts puede meter hasta 300 caracteres del
    // cuerpo de la respuesta de Canva en error.message.
    console.error("[api/canva/callback] no se pudo completar la conexión:", error instanceof Error ? error.name : String(error));
    return volver("canva=error&codigo=error_desconocido");
  }
}
