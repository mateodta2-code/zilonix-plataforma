import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso } from "../../../_ayudantes";
import { NextResponse } from "next/server";
import { asignarModulos } from "@/lib/ia/conexion";
import { validarModulosIA } from "@/lib/ia/modulos";
import { sesionIA, idValido, respuestaNoEncontrada, respuestaSiErrorDominio } from "../../../_ia";

// Body { modulos: ModuloIA[] }: deja a esta conexión con esos módulos
// (un módulo asignado aquí se quita de la otra IA que lo tuviera).
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
  const cuerpo = (await request.json().catch(() => null)) as { modulos?: unknown } | null;
  const modulos = validarModulosIA(cuerpo?.modulos);
  if (!modulos) return NextResponse.json({ error: "Módulo no válido." }, { status: 400 });
  try {
    await asignarModulos(sesion.empresa.id, params.id, modulos);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const r = respuestaSiErrorDominio(error);
    if (r) return r;
    throw error;
  }
}
