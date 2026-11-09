import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { calcularCodeChallenge, construirUrlAutorizacion, generarCodeVerifier, generarState } from "@/lib/canva/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/canva/pkce-cookie";
import { resolverSesionYEmpresa, respuestaSiSinPermiso } from "../_ayudantes";

// Cada usuario conecta SU PROPIA cuenta de Canva — mismo mecanismo PKCE
// que /api/ml/conectar, verifier/state en cookies httpOnly de corta
// vida (10 min, de sobra para autorizar en Canva).

// Saca de un texto cualquier VALOR sensible real (nunca el nombre de la
// variable, eso no es secreto) antes de mandarlo a los logs de Railway.
// Hace falta porque un Error de "URL inválida", por ejemplo, trae el
// string completo que se intentó armar — y ese string puede tener
// adentro el code_verifier/state que se graban como cookies.
function redactar(texto: string, valores: Array<string | undefined>): string {
  let resultado = texto;
  for (const valor of valores) {
    if (valor) resultado = resultado.split(valor).join("[redactado]");
  }
  return resultado;
}

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

  let codeVerifier: string | undefined;
  let state: string | undefined;

  try {
    codeVerifier = generarCodeVerifier();
    const codeChallenge = calcularCodeChallenge(codeVerifier);
    state = generarState();
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
    // ni siquiera se llegó a pedir nada a Canva. error.message y la
    // primera línea del stack sí se registran (requerirVariable solo
    // nombra la variable, nunca su valor), pero redactados por si el
    // error viene de otro lado y trae code_verifier/state adentro.
    const valoresSensibles = [process.env.CANVA_CLIENT_ID, process.env.CANVA_CLIENT_SECRET, codeVerifier, state];
    const mensaje = error instanceof Error ? redactar(error.message, valoresSensibles) : String(error);
    const primeraLineaStack = error instanceof Error ? redactar((error.stack?.split("\n")[1] ?? "").trim(), valoresSensibles) : "";
    console.error(
      "[api/canva/conectar] no se pudo iniciar la conexión:",
      error instanceof Error ? error.name : String(error),
      "—",
      mensaje,
      "—",
      primeraLineaStack,
      "— CANVA_CLIENT_ID presente:",
      Boolean(process.env.CANVA_CLIENT_ID?.trim()),
      "— RAILWAY_PUBLIC_DOMAIN presente:",
      Boolean(process.env.RAILWAY_PUBLIC_DOMAIN?.trim()),
      "— urlPublicaBase():",
      urlPublicaBase()
    );
    return NextResponse.redirect(`${urlPublicaBase()}/panel/publicar?canva=error&codigo=error_desconocido`);
  }
}
