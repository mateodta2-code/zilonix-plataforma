import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { listarCuentasConectadas } from "@/lib/ml/cuentas";
import { iniciarBusquedaPromociones } from "@/lib/trabajos/buscarPromocionesMultiCuenta";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 3/4 — "botón 'Buscar promociones en
// todas' (o en la cuenta elegida)". Arranca el trabajo en segundo
// plano (lib/trabajos/buscarPromocionesMultiCuenta.ts) y devuelve
// {jobId} de inmediato — la UI consulta el progreso en
// /api/ml/promociones/trabajo/[jobId].
export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

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

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = {};
  }
  const cuentaIdPedida = typeof (cuerpo as { cuentaId?: unknown })?.cuentaId === "string" ? (cuerpo as { cuentaId: string }).cuentaId : null;
  if (cuentaIdPedida && !PATRON_UUID.test(cuentaIdPedida)) {
    return NextResponse.json({ error: "cuentaId inválido." }, { status: 400 });
  }

  const cuentasConectadas = (await listarCuentasConectadas(empresa.id)).filter((c) => !c.desconectadaTs);
  const cuentasParaBuscar = cuentaIdPedida ? cuentasConectadas.filter((c) => c.id === cuentaIdPedida) : cuentasConectadas;
  if (cuentasParaBuscar.length === 0) {
    return NextResponse.json({ error: "No hay ninguna cuenta conectada para buscar." }, { status: 400 });
  }

  const jobId = iniciarBusquedaPromociones(
    empresa.id,
    cuentasParaBuscar.map((c) => ({ cuentaMlId: c.id, cuentaId: c.id, cuentaIdExterna: c.cuentaIdExterna, nickname: c.nickname }))
  );
  return NextResponse.json({ jobId });
}
