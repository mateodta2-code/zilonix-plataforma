import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso } from "../_ayudantes";
import { NextResponse } from "next/server";
import { crearConexionIA, listarConexionesIA, MENSAJE_LIMITE_IA } from "@/lib/ia/conexion";
import { MAX_CONEXIONES_IA } from "@/lib/ia/modulos";
import { sesionIA, leerDatosConexion, respuestaSiErrorDominio } from "../_ia";

// «Conectar IA» (Administración): varias IA por empresa, máximo 5. Vive
// bajo el módulo "configuracion" (consultar/modificar). Nunca devuelve
// la API key.
export async function GET() {
  const sesion = await sesionIA(null);
  if (sesion instanceof NextResponse) return sesion;
  try {
    await requierePermiso(sesion.usuario.id, sesion.empresa.id, "configuracion", "consultar");
  } catch (error) {
    const sinPermiso = respuestaSiSinPermiso(error);
    if (sinPermiso) return sinPermiso;
    throw error;
  }
  const conexiones = await listarConexionesIA(sesion.empresa.id);
  // `conexion` (la principal) se mantiene por compatibilidad con la
  // respuesta vieja { conexion }.
  const conexion = conexiones.find((c) => c.esPrincipal) ?? null;
  return NextResponse.json({ conexiones, conexion });
}

export async function POST(request: Request) {
  const sesion = await sesionIA(request);
  if (sesion instanceof NextResponse) return sesion;
  try {
    await requierePermiso(sesion.usuario.id, sesion.empresa.id, "configuracion", "modificar");
  } catch (error) {
    const sinPermiso = respuestaSiSinPermiso(error);
    if (sinPermiso) return sinPermiso;
    throw error;
  }
  const datos = await leerDatosConexion(request, { exigirKey: true });
  if (datos instanceof NextResponse) return datos;
  try {
    const conexiones = await listarConexionesIA(sesion.empresa.id);
    if (conexiones.length >= MAX_CONEXIONES_IA) return NextResponse.json({ error: MENSAJE_LIMITE_IA }, { status: 409 });
    const creada = await crearConexionIA(sesion.empresa.id, sesion.usuario.id, datos);
    return NextResponse.json({ ok: true, conexion: creada }, { status: 201 });
  } catch (error) {
    const r = respuestaSiErrorDominio(error);
    if (r) return r;
    throw error;
  }
}
