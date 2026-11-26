import { timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { CuentaMpDeOtraEmpresaError, guardarCuentaMpConectada } from "@/lib/mp/cuentas";
import { intercambiarCodigo, obtenerDatosUsuarioMp } from "@/lib/mp/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, PATH_COOKIE_STATE } from "@/lib/mp/state-cookie";

// Mismo criterio que /api/ml/callback: timingSafeEqual exige buffers de
// igual longitud (lanza si no), así que primero se comparan longitudes.
function coincideState(recibido: string, esperado: string): boolean {
  const bufferRecibido = Buffer.from(recibido);
  const bufferEsperado = Buffer.from(esperado);
  if (bufferRecibido.length !== bufferEsperado.length) return false;
  return timingSafeEqual(bufferRecibido, bufferEsperado);
}

// Issue #422 (Bloque 1) — a dónde vuelve Mercado Pago después de que la
// empresa autoriza (o cancela). Pública en el middleware
// (lib/rutas-publicas.ts) pero valida sesión, empresa, permiso y state
// por su cuenta antes de guardar nada. A la URL solo van códigos fijos
// con prefijo `mp_` (page.tsx los traduce), nunca texto crudo.
export async function GET(request: NextRequest) {
  const base = urlPublicaBase();
  const volver = (query: string) => {
    const respuesta = NextResponse.redirect(`${base}/panel/conectar-ml?${query}`);
    // El state es de un solo uso: se borra en TODO camino de salida, con
    // el MISMO path con el que se puso (si no, el navegador no lo borra).
    respuesta.cookies.set(NOMBRE_COOKIE_STATE, "", { path: PATH_COOKIE_STATE, maxAge: 0 });
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
    if (error instanceof SinPermisoError) return volver("error=mp_sin_permiso");
    throw error;
  }

  // La empresa canceló o Mercado Pago rechazó — nunca se refleja el valor.
  if (request.nextUrl.searchParams.get("error")) return volver("error=mp_rechazo");

  const code = request.nextUrl.searchParams.get("code");
  if (!code) return volver("error=mp_rechazo");

  // state ANTES de canjear el code, nunca después.
  const stateRecibido = request.nextUrl.searchParams.get("state");
  const stateEsperado = cookies().get(NOMBRE_COOKIE_STATE)?.value;
  if (!stateRecibido || !stateEsperado || !coincideState(stateRecibido, stateEsperado)) {
    return volver("error=mp_estado_vencido");
  }

  try {
    const tokens = await intercambiarCodigo(code);
    const { nickname } = await obtenerDatosUsuarioMp(tokens.accessToken);
    await guardarCuentaMpConectada(empresa.id, { cuentaIdExterna: tokens.cuentaIdExterna, nickname, tokens });
    return volver("conectado_mp=1");
  } catch (error) {
    if (error instanceof CuentaMpDeOtraEmpresaError) return volver("error=mp_cuenta_en_otra_empresa");
    // Solo error.name: error.message puede traer texto crudo de Mercado
    // Pago (lib/mp/oauth.ts) — nunca tokens ni cuerpos en el log.
    console.error("[api/mp/callback] no se pudo completar la conexión:", error instanceof Error ? error.name : String(error));
    return volver("error=mp_error_desconocido");
  }
}
