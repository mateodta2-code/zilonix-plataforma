import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso } from "../../_ayudantes";
import { NextResponse } from "next/server";
import { actualizarConexionIA, eliminarConexionIA } from "@/lib/ia/conexion";
import { sesionIA, idValido, leerDatosConexion, respuestaNoEncontrada, respuestaSiErrorDominio } from "../../_ia";

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
  const datos = await leerDatosConexion(request, { exigirKey: false });
  if (datos instanceof NextResponse) return datos;
  try {
    const conexion = await actualizarConexionIA(sesion.empresa.id, sesion.usuario.id, params.id, { ...datos, apiKey: datos.apiKey || undefined });
    return NextResponse.json({ ok: true, conexion });
  } catch (error) {
    const r = respuestaSiErrorDominio(error);
    if (r) return r;
    throw error;
  }
}

export async function DELETE(request: Request, { params }: { params: { id: string } }) {
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
    await eliminarConexionIA(sesion.empresa.id, params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const r = respuestaSiErrorDominio(error);
    if (r) return r;
    throw error;
  }
}
