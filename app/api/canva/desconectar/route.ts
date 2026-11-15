import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { desconectarConexion } from "@/lib/canva/conexiones";
import { urlPublicaBase } from "@/lib/url-publica";
import { resolverSesionYEmpresa, respuestaSiOrigenInvalido, respuestaSiSinPermiso } from "../_ayudantes";

export async function POST(request: Request) {
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(urlPublicaBase()).origin);
  if (respuestaOrigen) return respuestaOrigen;

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

  await desconectarConexion(empresa.id, usuario.id);
  return NextResponse.json({ ok: true });
}
