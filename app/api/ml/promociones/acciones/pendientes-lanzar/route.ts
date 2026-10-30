import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesAcciones } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Review de Pablo (PR #304) — el botón "Lanzar aprobadas a Mercado
// Libre (N)" necesita el total REAL de acciones "aceptada" sin
// simulación de la empresa entera, nunca `historial.length` (esa
// ruta trae un .limit(200) pensado para la pestaña Historial, no para
// contar) — un lote de más de 200 aprobadas mostraba un N inflado a
// la baja y el confirm no coincidía con lo que de verdad iba a lanzar.
// count(*) real, mismo criterio que lib/ml/despachos.ts/pedidos.ts.
export async function GET() {
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

  const [fila] = await dbComoEmpresa(empresa.id, (tx) =>
    tx
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(promocionesAcciones)
      .where(
        and(
          eq(promocionesAcciones.empresaId, empresa.id),
          eq(promocionesAcciones.estado, "aceptada"),
          eq(promocionesAcciones.modoSimulacion, false)
        )
      )
  );

  return NextResponse.json({ total: fila?.total ?? 0 });
}
