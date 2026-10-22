import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { guardarCuentaConectada } from "@/lib/ml/cuentas";
import { intercambiarCodigo, obtenerNickname } from "@/lib/ml/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/ml/pkce-cookie";
import { ejecutarImportacionInicial } from "@/lib/ml/importacion";

// Mismo criterio que el secreto del trabajador (app/api/ml/trabajador/
// route.ts): comparar con crypto.timingSafeEqual, no con "===" — y
// timingSafeEqual exige buffers de IGUAL longitud (lanza si no), así
// que primero se comparan las longitudes.
function coincideState(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

// Tarea 2.3 — a dónde vuelve Mercado Libre después de que el vendedor
// autoriza (o cancela). Mismo redirect_uri que se le pasó al armar el
// link de autorización — Mercado Libre exige que coincidan EXACTO.
export async function GET(request: NextRequest) {
  const base = urlPublicaBase();
  const volver = (query: string) => {
    const respuesta = NextResponse.redirect(`${base}/panel/conectar-ml?${query}`);
    // El verifier y el state son de un solo uso — se borran en TODO
    // camino de salida de esta ruta, no solo en el de éxito.
    respuesta.cookies.delete(NOMBRE_COOKIE_VERIFIER);
    respuesta.cookies.delete(NOMBRE_COOKIE_STATE);
    return respuesta;
  };

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.redirect(`${base}/sign-in`);

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.redirect(`${base}/crear-empresa`);

  try {
    await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");
  } catch (error) {
    // Antes esto no se atrapaba acá — un usuario sin permiso (ej. el
    // rol cambió entre que abrió el link y que Mercado Libre lo trajo
    // de vuelta) veía la página de error genérica de Next.js en vez de
    // volver a /panel/conectar-ml con un mensaje legible.
    if (error instanceof SinPermisoError) {
      return volver(`error=${encodeURIComponent(error.message)}`);
    }
    throw error;
  }

  const errorMl = request.nextUrl.searchParams.get("error");
  if (errorMl) {
    // El vendedor canceló en la pantalla de Mercado Libre, o ML
    // rechazó la autorización — no es un fallo técnico nuestro.
    return volver(`error=${encodeURIComponent("Mercado Libre no autorizó la conexión (" + errorMl + ").")}`);
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return volver(`error=${encodeURIComponent("Mercado Libre no envió un código de autorización.")}`);
  }

  // state (RFC 6749 §10.12, protección CSRF — ver generarState() en
  // lib/ml/oauth.ts): se compara ANTES de canjear el code, nunca
  // después — canjear el code primero y revisar el state después ya
  // habría gastado el code de un posible atacante sin ninguna ganancia.
  const stateRecibido = request.nextUrl.searchParams.get("state");
  const stateEsperado = cookies().get(NOMBRE_COOKIE_STATE)?.value;
  if (!stateRecibido || !stateEsperado || !coincideState(stateRecibido, stateEsperado)) {
    return volver(
      `error=${encodeURIComponent("La conexión no se pudo validar (state inválido o vencido) — empieza de nuevo con 'Conectar Mercado Libre'.")}`
    );
  }

  // PKCE (bug real encontrado en vivo: "code_verifier is a required
  // parameter") — el verifier que /api/ml/conectar guardó en una
  // cookie httpOnly al armar el link de autorización.
  const codeVerifier = cookies().get(NOMBRE_COOKIE_VERIFIER)?.value;
  if (!codeVerifier) {
    return volver(
      `error=${encodeURIComponent("La conexión tardó demasiado o se perdió el estado — empieza de nuevo con 'Conectar Mercado Libre'.")}`
    );
  }

  try {
    const redirectUri = `${base}/api/ml/callback`;
    const tokens = await intercambiarCodigo(code, redirectUri, codeVerifier);
    const nickname = await obtenerNickname(tokens.accessToken);
    const cuenta = await guardarCuentaConectada(empresa.id, { cuentaIdExterna: tokens.cuentaIdExterna, nickname, tokens });

    // Tarea 2.5 — "en segundo plano": a propósito NO se espera (sin
    // await) para que la respuesta vuelva ya mismo; Railway corre un
    // proceso persistente (no serverless), así que el trabajo sigue
    // corriendo después de responder. Errores quedan guardados en la
    // propia fila de importaciones_ml (lib/ml/importacion.ts), nunca
    // tumban esta petición.
    ejecutarImportacionInicial(empresa.id, cuenta.id, tokens.cuentaIdExterna).catch((error) => {
      console.error("Error en la importación inicial:", error instanceof Error ? error.message : error);
    });

    return volver("conectado=1");
  } catch (error) {
    // Regla de UX #2 (evidencia real contra Multivende): nunca un
    // spinner infinito ni un "no hay conexiones" silencioso — se ve el
    // error real y la pantalla ofrece "Reintentar".
    const mensaje = error instanceof Error ? error.message : "Error desconocido.";
    return volver(`error=${encodeURIComponent(mensaje)}`);
  }
}
