import { NextResponse } from "next/server";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { listarParticipandoCuenta } from "@/lib/ml/promocionesParticipando";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama fix-promociones-aprobadas-participando, punto 3 — "Participando":
// promociones donde la cuenta YA está activa en Mercado Libre
// (started/pending). Sin cuentaId, trae todas las cuentas conectadas
// de la empresa (mismo criterio que .../candidatos); una cuenta con
// error puntual (token vencido, sin permiso) se omite, nunca tira
// abajo la respuesta completa — el resto de las cuentas sigue viéndose.
export async function GET(request: Request) {
  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "consultar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  const { searchParams } = new URL(request.url);
  const cuentaId = searchParams.get("cuentaId");
  if (cuentaId && !PATRON_UUID.test(cuentaId)) return NextResponse.json({ error: "cuentaId inválido." }, { status: 400 });

  const cuentasConectadas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const cuentasAConsultar = cuentaId ? cuentasConectadas.filter((c) => c.id === cuentaId) : cuentasConectadas;

  const filas = [];
  for (const cuenta of cuentasAConsultar) {
    let filasCuenta;
    try {
      filasCuenta = await listarParticipandoCuenta(empresa.id, cuenta.id);
    } catch {
      // Token vencido, cuenta desconectada a mitad de camino, etc. —
      // esta cuenta se omite, nunca rompe la vista completa (mismo
      // criterio que el resto del módulo: un error puntual nunca tapa
      // lo que sí se pudo traer de las demás cuentas).
      continue;
    }
    for (const fila of filasCuenta) {
      filas.push({ ...fila, nicknameCuenta: cuenta.nickname });
    }
  }

  return NextResponse.json({ filas });
}
