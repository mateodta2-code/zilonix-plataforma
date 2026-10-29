import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesAcciones } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { ejecutarLoteDeAcciones } from "@/lib/ml/promocionesEjecucion";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../../_ayudantes";

// MED 7 — paso separado de "ejecutar": una persona con solo "aprobar"
// deja acciones en cola ("aceptada") desde POST .../acciones; otra
// persona (o la misma, más tarde) con el permiso "ejecutar" las
// dispara de verdad contra Mercado Libre desde acá. Usa las MISMAS
// validaciones de dinero que el POST combinado
// (lib/ml/promocionesEjecucion.ts) — nunca una copia separada de esa
// lógica. `modoSimulacion` nunca llega acá: ya quedó fuera en el
// filtro mismo de qué se trae a ejecutar.
function parsearIds(cuerpo: unknown): string[] | null {
  const valor = (cuerpo as { ids?: unknown })?.ids;
  if (valor === undefined) return null; // sin filtro — ejecutar todas las "aceptada" pendientes de la empresa
  if (!Array.isArray(valor)) return [];
  return valor.filter((id): id is string => typeof id === "string" && PATRON_UUID.test(id));
}

export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  try {
    await requierePermiso(usuario.id, empresa.id, "promociones", "ejecutar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }

  let cuerpo: unknown = {};
  try {
    cuerpo = await request.json();
  } catch {
    cuerpo = {};
  }
  const idsFiltro = parsearIds(cuerpo);
  if (idsFiltro && idsFiltro.length === 0) {
    return NextResponse.json({ ok: true, acciones: [], ejecutado: true });
  }

  const condiciones = [eq(promocionesAcciones.estado, "aceptada"), eq(promocionesAcciones.modoSimulacion, false)];
  if (idsFiltro) condiciones.push(inArray(promocionesAcciones.id, idsFiltro));

  const pendientes = await dbComoEmpresa(empresa.id, (tx) => tx.select().from(promocionesAcciones).where(and(...condiciones)));
  if (pendientes.length === 0) {
    return NextResponse.json({ ok: true, acciones: [], ejecutado: true });
  }

  await ejecutarLoteDeAcciones(empresa.id, usuario.id, pendientes);

  const idsEjecutados = pendientes.map((f) => f.id);
  const filasFinal = await dbComoEmpresa(empresa.id, (tx) => tx.select().from(promocionesAcciones).where(inArray(promocionesAcciones.id, idsEjecutados)));

  return NextResponse.json({ ok: true, acciones: filasFinal, ejecutado: true });
}
