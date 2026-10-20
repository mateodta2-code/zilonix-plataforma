import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { listarEmpresasDeUsuario } from "@/lib/empresas";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { requierePermiso } from "@/lib/permisos";
import { guardarCuentaConectada } from "@/lib/ml/cuentas";
import { intercambiarCodigo, obtenerNickname } from "@/lib/ml/oauth";
import { urlPublicaBase } from "@/lib/url-publica";

// Tarea 2.3 — a dónde vuelve Mercado Libre después de que el vendedor
// autoriza (o cancela). Mismo redirect_uri que se le pasó al armar el
// link de autorización — Mercado Libre exige que coincidan EXACTO.
export async function GET(request: NextRequest) {
  const base = urlPublicaBase();
  const volver = (query: string) => NextResponse.redirect(`${base}/panel/conectar-ml?${query}`);

  const usuario = await obtenerOCrearUsuarioActual();
  if (!usuario) return NextResponse.redirect(`${base}/sign-in`);

  const propias = await listarEmpresasDeUsuario(usuario.id);
  const empresaId = cookies().get("empresa_actual")?.value;
  const empresa = propias.find((e) => e.id === empresaId) ?? propias[0];
  if (!empresa) return NextResponse.redirect(`${base}/crear-empresa`);

  await requierePermiso(usuario.id, empresa.id, "configuracion", "crear");

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

  try {
    const redirectUri = `${base}/api/ml/callback`;
    const tokens = await intercambiarCodigo(code, redirectUri);
    const nickname = await obtenerNickname(tokens.accessToken);
    await guardarCuentaConectada(empresa.id, { cuentaIdExterna: tokens.cuentaIdExterna, nickname, tokens });
    return volver("conectado=1");
  } catch (error) {
    // Regla de UX #2 (evidencia real contra Multivende): nunca un
    // spinner infinito ni un "no hay conexiones" silencioso — se ve el
    // error real y la pantalla ofrece "Reintentar".
    const mensaje = error instanceof Error ? error.message : "Error desconocido.";
    return volver(`error=${encodeURIComponent(mensaje)}`);
  }
}
