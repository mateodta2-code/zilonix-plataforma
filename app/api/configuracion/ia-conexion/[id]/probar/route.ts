import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso } from "../../../_ayudantes";
import { NextResponse } from "next/server";
import { probarConexionIA } from "@/lib/ia/probarConexion";
import { creaContador, superaLimite } from "@/lib/limite-peticiones";
import { sesionIA, idValido, respuestaNoEncontrada } from "../../../_ia";

// Límite por empresa: 5 pruebas por minuto (memoria del proceso, igual
// que lib/limite-peticiones.ts). Cada prueba gasta una llamada real
// pagada por la empresa.
const pruebas = creaContador();

export async function POST(request: Request, { params }: { params: { id: string } }) {
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
  if (superaLimite(pruebas, sesion.empresa.id, 5, 60_000)) {
    return NextResponse.json({ ok: false, error: "Hiciste muchas pruebas seguidas. Espera un minuto." }, { status: 429 });
  }
  return NextResponse.json(await probarConexionIA(sesion.empresa.id, params.id));
}
