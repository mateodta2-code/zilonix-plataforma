import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesAcciones } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, pestaña Historial — "quién aprobó, cuándo,
// precio antes y después, resultado de ML y error si lo hubo".
const ESTADOS = ["pendiente", "aceptada", "rechazada", "ejecutada", "fallida"] as const;

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
  const estadoCrudo = searchParams.get("estado");
  const estado = estadoCrudo && (ESTADOS as readonly string[]).includes(estadoCrudo) ? estadoCrudo : null;

  const filas = await dbComoEmpresa(empresa.id, (tx) => {
    const condiciones = [eq(promocionesAcciones.empresaId, empresa.id)];
    if (cuentaId) condiciones.push(eq(promocionesAcciones.cuentaMlId, cuentaId));
    if (estado) condiciones.push(eq(promocionesAcciones.estado, estado as (typeof ESTADOS)[number]));
    return tx
      .select({
        id: promocionesAcciones.id,
        cuentaMlId: promocionesAcciones.cuentaMlId,
        nicknameCuenta: cuentasMl.nickname,
        itemId: promocionesAcciones.itemId,
        tituloProducto: promocionesAcciones.tituloProducto,
        tipoPromocion: promocionesAcciones.tipoPromocion,
        accion: promocionesAcciones.accion,
        precioAntes: promocionesAcciones.precioAntes,
        precioDespues: promocionesAcciones.precioDespues,
        estado: promocionesAcciones.estado,
        aprobadoPor: promocionesAcciones.aprobadoPor,
        aprobadoTs: promocionesAcciones.aprobadoTs,
        ejecutadoTs: promocionesAcciones.ejecutadoTs,
        modoSimulacion: promocionesAcciones.modoSimulacion,
        error: promocionesAcciones.error,
        creadoTs: promocionesAcciones.creadoTs,
      })
      .from(promocionesAcciones)
      .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesAcciones.cuentaMlId))
      .where(and(...condiciones))
      .orderBy(desc(promocionesAcciones.creadoTs))
      .limit(200);
  });

  return NextResponse.json({ filas });
}
