import { and, desc, eq, gte, lt, sql, type SQL } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesAcciones, usuarios } from "@/db/schema";
import { resumirResultadoMl } from "@/lib/ml/promocionesBitacora";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, pestaña Historial — "quién aprobó, cuándo,
// precio antes y después, resultado de ML y error si lo hubo".
const ACCIONES = ["participar", "modificar", "salir"] as const;
const TAMANO_PAGINA = 50;
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
  const accionCruda = searchParams.get("accion");
  const accion = accionCruda && (ACCIONES as readonly string[]).includes(accionCruda) ? accionCruda : null;
  const resultadoCrudo = searchParams.get("resultado");
  const resultado = resultadoCrudo === "ok" || resultadoCrudo === "error" ? resultadoCrudo : null;
  const desde = leerFecha(searchParams.get("desde"));
  const hasta = leerFecha(searchParams.get("hasta"));
  if (searchParams.get("desde") && !desde) return NextResponse.json({ error: "desde inválido (AAAA-MM-DD)." }, { status: 400 });
  if (searchParams.get("hasta") && !hasta) return NextResponse.json({ error: "hasta inválido (AAAA-MM-DD)." }, { status: 400 });
  const pagina = Math.max(1, Math.floor(Number(searchParams.get("pagina"))) || 1);

  const filas = await dbComoEmpresa(empresa.id, (tx) => {
    const condiciones: SQL[] = [eq(promocionesAcciones.empresaId, empresa.id)];
    if (cuentaId) condiciones.push(eq(promocionesAcciones.cuentaMlId, cuentaId));
    if (estado) condiciones.push(eq(promocionesAcciones.estado, estado as (typeof ESTADOS)[number]));
    if (accion) condiciones.push(eq(promocionesAcciones.accion, accion as (typeof ACCIONES)[number]));
    if (resultado === "ok") condiciones.push(eq(promocionesAcciones.estado, "ejecutada"));
    if (resultado === "error") condiciones.push(eq(promocionesAcciones.estado, "fallida"));
    // Rango por día calendario de Colombia (UTC-5, sin horario de verano).
    if (desde) condiciones.push(gte(promocionesAcciones.creadoTs, new Date(`${desde}T00:00:00-05:00`)));
    if (hasta) condiciones.push(lt(promocionesAcciones.creadoTs, new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000)));
    return tx
      .select({
        id: promocionesAcciones.id,
        cuentaMlId: promocionesAcciones.cuentaMlId,
        nicknameCuenta: cuentasMl.nickname,
        itemId: promocionesAcciones.itemId,
        tituloProducto: promocionesAcciones.tituloProducto,
        tipoPromocion: promocionesAcciones.tipoPromocion,
        promotionIdMl: promocionesAcciones.promotionIdMl,
        accion: promocionesAcciones.accion,
        precioAntes: promocionesAcciones.precioAntes,
        precioDespues: promocionesAcciones.precioDespues,
        estado: promocionesAcciones.estado,
        aprobadoPor: promocionesAcciones.aprobadoPor,
        aprobadoTs: promocionesAcciones.aprobadoTs,
        ejecutadoPor: promocionesAcciones.ejecutadoPor,
        ejecutadoPorNombre: sql<string | null>`coalesce(${usuarios.nombre}, ${usuarios.email})`,
        ejecutadoTs: promocionesAcciones.ejecutadoTs,
        modoSimulacion: promocionesAcciones.modoSimulacion,
        resultadoMl: promocionesAcciones.resultadoMl,
        error: promocionesAcciones.error,
        creadoTs: promocionesAcciones.creadoTs,
      })
      .from(promocionesAcciones)
      .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesAcciones.cuentaMlId))
      .leftJoin(usuarios, eq(usuarios.id, promocionesAcciones.ejecutadoPor))
      .where(and(...condiciones))
      .orderBy(desc(promocionesAcciones.creadoTs))
      .limit(TAMANO_PAGINA + 1)
      .offset((pagina - 1) * TAMANO_PAGINA);
  });

  const hayMas = filas.length > TAMANO_PAGINA;
  const visibles = filas.slice(0, TAMANO_PAGINA).map(({ resultadoMl, error, ...resto }) => ({
    ...resto,
    // Nunca el JSON crudo de ML ni más de 500 caracteres del cuerpo.
    detalle: resumirResultadoMl(resultadoMl),
    error: error ? error.slice(0, 500) : null,
  }));

  return NextResponse.json({ filas: visibles, pagina, tamanoPagina: TAMANO_PAGINA, hayMas });
}

function leerFecha(valor: string | null): string | null {
  if (!valor || !/^\d{4}-\d{2}-\d{2}$/.test(valor)) return null;
  return Number.isNaN(new Date(`${valor}T00:00:00-05:00`).getTime()) ? null : valor;
}
