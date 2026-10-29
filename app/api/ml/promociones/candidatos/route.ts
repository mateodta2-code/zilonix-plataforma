import { and, desc, eq, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 3 — la tabla principal de la pantalla.
// Lee el snapshot de la última búsqueda (promociones_candidatos, ya
// upserteado por el trabajo) con los filtros reales: Todas / Cumplen /
// Revisar a mano / Sin precio mínimo / Solo en ML.
const FILTROS = ["todas", "cumplen", "revisar", "sin-minimo", "solo-ml"] as const;
type Filtro = (typeof FILTROS)[number];

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
  const filtroCrudo = searchParams.get("filtro") ?? "todas";
  const filtro: Filtro = (FILTROS as readonly string[]).includes(filtroCrudo) ? (filtroCrudo as Filtro) : "todas";

  const filas = await dbComoEmpresa(empresa.id, (tx) => {
    const condiciones = [eq(promocionesCandidatos.empresaId, empresa.id)];
    if (cuentaId) condiciones.push(eq(promocionesCandidatos.cuentaMlId, cuentaId));
    if (filtro === "cumplen") condiciones.push(eq(promocionesCandidatos.cumpleReglas, true));
    if (filtro === "solo-ml") condiciones.push(eq(promocionesCandidatos.soloEnMl, true));
    if (filtro === "sin-minimo") condiciones.push(isNull(promocionesCandidatos.precioMinimo));
    if (filtro === "revisar") {
      condiciones.push(eq(promocionesCandidatos.cumpleReglas, false));
      condiciones.push(eq(promocionesCandidatos.soloEnMl, false));
    }
    return tx
      .select({
        id: promocionesCandidatos.id,
        cuentaMlId: promocionesCandidatos.cuentaMlId,
        nicknameCuenta: cuentasMl.nickname,
        itemId: promocionesCandidatos.itemId,
        skuCodigo: promocionesCandidatos.skuCodigo,
        tituloProducto: promocionesCandidatos.tituloProducto,
        thumbnail: promocionesCandidatos.thumbnail,
        tieneVariantes: promocionesCandidatos.tieneVariantes,
        tipoPromocion: promocionesCandidatos.tipoPromocion,
        estadoMl: promocionesCandidatos.estadoMl,
        esCompartida: promocionesCandidatos.esCompartida,
        soloEnMl: promocionesCandidatos.soloEnMl,
        precioOriginal: promocionesCandidatos.precioOriginal,
        precioActual: promocionesCandidatos.precioActual,
        precioMinimo: promocionesCandidatos.precioMinimo,
        precioSugerido: promocionesCandidatos.precioSugerido,
        gananciaEstimada: promocionesCandidatos.gananciaEstimada,
        cumpleReglas: promocionesCandidatos.cumpleReglas,
        motivoRevisarManual: promocionesCandidatos.motivoRevisarManual,
        actualizadoTs: promocionesCandidatos.actualizadoTs,
      })
      .from(promocionesCandidatos)
      .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesCandidatos.cuentaMlId))
      .where(and(...condiciones))
      .orderBy(desc(promocionesCandidatos.actualizadoTs));
  });

  return NextResponse.json({ filas });
}
