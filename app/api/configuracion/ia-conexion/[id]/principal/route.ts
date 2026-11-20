import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso } from "../../../_ayudantes";
import { NextResponse } from "next/server";
import { marcarPrincipal } from "@/lib/ia/conexion";
import { sesionIA, idValido, respuestaNoEncontrada, respuestaSiErrorDominio } from "../../../_ia";

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const sesion = await sesionIA(request);
  if (sesion instanceof NextResponse) return sesion;
  try {
    await requierePermiso(sesion.usuario.id, sesion.empresa.id, "configuracion", "modificar");
  } catch (error) {
    const sinPermiso = respuestaSiSinPermiso(error);
    if (sinPermiso) return sinPermiso;
    throw error;
  }
  if (!idValido(params.id)) return respuestaNoEncontrada();
  try {
    await marcarPrincipal(sesion.empresa.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const r = respuestaSiErrorDominio(error);
    if (r) return r;
    throw error;
  }
}
