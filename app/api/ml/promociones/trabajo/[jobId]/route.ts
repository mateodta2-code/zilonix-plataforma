import { NextResponse } from "next/server";
import { requierePermiso } from "@/lib/permisos";
import { obtenerTrabajoBusquedaPromociones } from "@/lib/trabajos/buscarPromocionesMultiCuenta";
import { respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// GET de solo lectura (nunca cambia estado) — sin CSRF por Origin,
// mismo criterio que app/api/ml/clip/trabajo/[jobId]/route.ts.
export async function GET(_request: Request, { params }: { params: { jobId: string } }) {
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

  const trabajo = obtenerTrabajoBusquedaPromociones(params.jobId, empresa.id);
  if (!trabajo) return NextResponse.json({ error: "No se encontró ese trabajo." }, { status: 404 });

  return NextResponse.json({ trabajo });
}
