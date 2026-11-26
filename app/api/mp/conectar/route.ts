import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { construirUrlAutorizacion, generarState } from "@/lib/mp/oauth";
import { urlPublicaBase } from "@/lib/url-publica";
import { NOMBRE_COOKIE_STATE, OPCIONES_COOKIE_STATE } from "@/lib/mp/state-cookie";

// Issue #422 (Bloque 1) — arranca el OAuth de Mercado Pago. Mismo molde
// que /api/ml/conectar: el `state` se genera recién al hacer clic (de un
// solo uso) y viaja en una cookie httpOnly con path /api/mp.
export async function GET() {
  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.redirect(`${urlPublicaBase()}/sign-in`);

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.redirect(`${urlPublicaBase()}/crear-empresa`);

  await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");

  const state = generarState();
  const respuesta = NextResponse.redirect(construirUrlAutorizacion(state));
  respuesta.cookies.set(NOMBRE_COOKIE_STATE, state, OPCIONES_COOKIE_STATE);
  return respuesta;
}
