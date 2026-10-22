import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { calcularCodeChallenge, construirUrlAutorizacion, generarCodeVerifier, generarState } from "@/lib/ml/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/ml/pkce-cookie";

// Tarea 2.3 — bug real encontrado en vivo: Mercado Libre exige PKCE
// para esta app ("code_verifier is a required parameter"). El verifier
// tiene que sobrevivir el viaje completo (acá → Mercado Libre → de
// vuelta a /api/ml/callback) sin que nadie más pueda leerlo — una
// cookie httpOnly de corta duración alcanza, no hace falta guardarlo en
// la base solo para esto.
export async function GET() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.redirect(`${urlPublicaBase()}/sign-in`);

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.redirect(`${urlPublicaBase()}/crear-empresa`);

  await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");

  const codeVerifier = generarCodeVerifier();
  const codeChallenge = calcularCodeChallenge(codeVerifier);
  const state = generarState();
  const redirectUri = `${urlPublicaBase()}/api/ml/callback`;
  const urlAutorizacion = construirUrlAutorizacion(redirectUri, codeChallenge, state);

  const respuesta = NextResponse.redirect(urlAutorizacion);
  const opcionesCookie = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    maxAge: 600, // 10 minutos — de sobra para autorizar en Mercado Libre, corto si nadie vuelve
    path: "/api/ml",
  };
  respuesta.cookies.set(NOMBRE_COOKIE_VERIFIER, codeVerifier, opcionesCookie);
  respuesta.cookies.set(NOMBRE_COOKIE_STATE, state, opcionesCookie);
  return respuesta;
}
