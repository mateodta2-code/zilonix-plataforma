import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { CuentaMlDeOtraEmpresaError, guardarCuentaConectada } from "@/lib/ml/cuentas";
import { intercambiarCodigo, obtenerDatosVendedorMl } from "@/lib/ml/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/ml/pkce-cookie";
import { ejecutarImportacionInicial } from "@/lib/ml/importacion";
import {
  cifrarTransferenciaPendiente,
  NOMBRE_COOKIE_TRANSFERENCIA,
  OPCIONES_COOKIE_TRANSFERENCIA,
  type TransferenciaPendiente,
} from "@/lib/ml/transferencia-cookie";

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
    //
    // Bug real: `.cookies.delete(nombre)` sin más manda un Set-Cookie
    // con Path=/ por defecto — como la cookie original se puso con
    // Path=/api/ml (/api/ml/conectar/route.ts), el navegador lo trata
    // como una cookie DISTINTA: nunca borra la original, que se queda
    // viva hasta sus 600s. Hay que borrarla con el MISMO path con el
    // que se puso, o no se borra de verdad.
    respuesta.cookies.set(NOMBRE_COOKIE_VERIFIER, "", { path: "/api/ml", maxAge: 0 });
    respuesta.cookies.set(NOMBRE_COOKIE_STATE, "", { path: "/api/ml", maxAge: 0 });
    return respuesta;
  };

  // Issue #181 — en vez de solo avisar "ya está conectada a otra
  // empresa" y cortar ahí, se ofrece transferirla: los tokens nuevos
  // (recién autorizados en Mercado Libre, todavía no se guardaron en
  // ningún lado) viajan cifrados en una cookie httpOnly de corta vida
  // — NUNCA en la URL ni en un log — hasta que se confirme o se
  // cancele en /panel/conectar-ml/confirmar-transferencia.
  const volverATransferencia = (pendiente: TransferenciaPendiente) => {
    const respuesta = NextResponse.redirect(`${base}/panel/conectar-ml/confirmar-transferencia`);
    respuesta.cookies.set(NOMBRE_COOKIE_VERIFIER, "", { path: "/api/ml", maxAge: 0 });
    respuesta.cookies.set(NOMBRE_COOKIE_STATE, "", { path: "/api/ml", maxAge: 0 });
    respuesta.cookies.set(NOMBRE_COOKIE_TRANSFERENCIA, cifrarTransferenciaPendiente(pendiente), OPCIONES_COOKIE_TRANSFERENCIA);
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
      return volver("error=sin_permiso");
    }
    throw error;
  }

  // Bug real: antes se mandaba error.message (o el ?error= crudo de
  // Mercado Libre) tal cual a la URL, y app/panel/conectar-ml/page.tsx
  // lo mostraba tal cual en pantalla — el texto crudo de Postgres o de
  // Mercado Libre nunca tiene que llegar ahí. Ahora un código fijo
  // nada más; page.tsx traduce cada uno a su propio mensaje en
  // español desde un mapa cerrado.
  const errorMl = request.nextUrl.searchParams.get("error");
  if (errorMl) {
    // El vendedor canceló en la pantalla de Mercado Libre, o ML
    // rechazó la autorización — no es un fallo técnico nuestro.
    return volver("error=ml_rechazo");
  }

  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return volver("error=ml_rechazo");
  }

  // state (RFC 6749 §10.12, protección CSRF — ver generarState() en
  // lib/ml/oauth.ts): se compara ANTES de canjear el code, nunca
  // después — canjear el code primero y revisar el state después ya
  // habría gastado el code de un posible atacante sin ninguna ganancia.
  const stateRecibido = request.nextUrl.searchParams.get("state");
  const stateEsperado = cookies().get(NOMBRE_COOKIE_STATE)?.value;
  if (!stateRecibido || !stateEsperado || !coincideState(stateRecibido, stateEsperado)) {
    return volver("error=estado_vencido");
  }

  // PKCE (bug real encontrado en vivo: "code_verifier is a required
  // parameter") — el verifier que /api/ml/conectar guardó en una
  // cookie httpOnly al armar el link de autorización.
  const codeVerifier = cookies().get(NOMBRE_COOKIE_VERIFIER)?.value;
  if (!codeVerifier) {
    return volver("error=estado_vencido");
  }

  try {
    const redirectUri = `${base}/api/ml/callback`;
    const tokens = await intercambiarCodigo(code, redirectUri, codeVerifier);
    const { nickname, siteId } = await obtenerDatosVendedorMl(tokens.accessToken);

    let cuenta: { id: string };
    try {
      cuenta = await guardarCuentaConectada(empresa.id, { cuentaIdExterna: tokens.cuentaIdExterna, nickname, tokens, siteId });
    } catch (error) {
      // Issue #181 — ya no se corta con un error genérico: se ofrece
      // transferir. tokens/nickname recién se obtuvieron de Mercado
      // Libre acá mismo, dentro de este try — por eso este catch
      // interno, en vez de uno externo que no podría verlos todavía
      // asignados con certeza.
      if (error instanceof CuentaMlDeOtraEmpresaError) {
        return volverATransferencia({ cuentaIdExterna: tokens.cuentaIdExterna, nickname, tokens, siteId });
      }
      throw error;
    }

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
    // spinner infinito ni un "no hay conexiones" silencioso — pero
    // tampoco el error real tal cual: para este punto ya se canjeó el
    // code por tokens nuevos en Mercado Libre, y oauth.ts puede meter
    // hasta 300 caracteres de la respuesta cruda de ML en
    // error.message — nunca se logea completo, solo error.name (mismo
    // criterio que lib/ml/cuentas.ts ya usa para la renovación).
    console.error("[api/ml/callback] no se pudo completar la conexión:", error instanceof Error ? error.name : String(error));
    return volver("error=error_desconocido");
  }
}
