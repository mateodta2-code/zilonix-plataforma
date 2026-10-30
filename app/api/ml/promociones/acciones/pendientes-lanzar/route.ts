import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesAcciones } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// Review de Pablo (PR #304) — el botón "Lanzar aprobadas a Mercado
// Libre (N)" necesita el total REAL de acciones "aceptada" sin
// simulación de la empresa entera, nunca `historial.length` (esa
// ruta trae un .limit(200) pensado para la pestaña Historial, no para
// contar) — un lote de más de 200 aprobadas mostraba un N inflado a
// la baja y el confirm no coincidía con lo que de verdad iba a lanzar.
// count(*) real, mismo criterio que lib/ml/despachos.ts/pedidos.ts.
//
// Rama fix-promociones-aprobar-no-ejecuta, punto 1 — además del
// total, ahora también trae las FILAS reales (producto, precio,
// cuenta) para el modal de confirmación de "Lanzar aprobadas", que
// tiene que listarlas antes de dejar confirmar — nunca un número
// pelado sin poder ver qué se va a mandar. Acotado a 100 para no
// mandar una lista gigante al navegador si se acumularon muchas sin
// lanzar; `total` sigue siendo el conteo real completo, sin este tope.
const TOPE_FILAS_MODAL = 100;

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

  const condiciones = [eq(promocionesAcciones.empresaId, empresa.id), eq(promocionesAcciones.estado, "aceptada"), eq(promocionesAcciones.modoSimulacion, false)];

  const [[fila], filas] = await dbComoEmpresa(empresa.id, (tx) =>
    Promise.all([
      tx.select({ total: sql<number>`count(*)`.mapWith(Number) }).from(promocionesAcciones).where(and(...condiciones)),
      tx
        .select({
          id: promocionesAcciones.id,
          cuentaMlId: promocionesAcciones.cuentaMlId,
          nicknameCuenta: cuentasMl.nickname,
          itemId: promocionesAcciones.itemId,
          tituloProducto: promocionesAcciones.tituloProducto,
          tipoPromocion: promocionesAcciones.tipoPromocion,
          precioAntes: promocionesAcciones.precioAntes,
          precioDespues: promocionesAcciones.precioDespues,
        })
        .from(promocionesAcciones)
        .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesAcciones.cuentaMlId))
        .where(and(...condiciones))
        .orderBy(desc(promocionesAcciones.creadoTs))
        .limit(TOPE_FILAS_MODAL),
    ])
  );

  return NextResponse.json({ total: fila?.total ?? 0, filas });
}
