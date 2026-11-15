import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { obtenerEstadoConexion } from "@/lib/canva/conexiones";
import { resolverSesionYEmpresa, respuestaSiSinPermiso } from "../_ayudantes";

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

  const estado = await obtenerEstadoConexion(empresa.id, usuario.id);
  return NextResponse.json(estado);
}
