import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { PATRON_UUID, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 3 — la tabla principal de la pantalla.
// Lee el snapshot de la última búsqueda (promociones_candidatos, ya
// upserteado por el trabajo).
//
// Rama feat-promociones-editar-precio, punto 2 — "Sí/No sacan la fila
// de la lista". El estado de decisión (pendiente/aprobada/rechazada)
// de cada candidato NUNCA se guarda en promociones_candidatos (ese
// snapshot se SOBREESCRIBE en cada búsqueda nueva, sin tocar ninguna
// decisión humana) — se deriva acá, al leer, de la ÚLTIMA fila de
// promociones_acciones para la misma (cuenta,ítem,tipo_promoción). Así
// "Buscar" de nuevo NUNCA resucita un rechazo como pendiente: una
// búsqueda nueva solo toca promociones_candidatos, jamás
// promociones_acciones — la última fila de acciones sigue siendo la
// misma "rechazada" de antes, sin importar cuántas veces se vuelva a
// buscar. "Volver a pendiente" (otra decisión humana) inserta una fila
// NUEVA con estado "pendiente" — eso sí vuelve a traer el producto acá.
//
// Se trae TODO promociones_acciones de la empresa (acotado a 5000 más
// recientes — no silencioso: una empresa con más de 5000 decisiones
// históricas podría ver un candidato viejísimo como "pendiente" por
// error; en la práctica, muy por encima de lo que cualquier empresa
// real acumula) y se reduce en memoria a "la última por combinación" —
// más simple y seguro de verificar que una subconsulta correlacionada
// en SQL cruda, sin Postgres real en este sandbox para probarla.
const FILTROS = ["todas", "cumplen", "revisar", "sin-minimo", "solo-ml", "aprobadas", "rechazadas"] as const;
type Filtro = (typeof FILTROS)[number];

const TOPE_ACCIONES_HISTORIAL = 5000;

type EstadoDecision = "pendiente" | "aceptada" | "rechazada" | "ejecutada" | "fallida";

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

  const [candidatosCrudos, accionesCrudas] = await dbComoEmpresa(empresa.id, async (tx) => {
    const condicionesCandidatos = [eq(promocionesCandidatos.empresaId, empresa.id)];
    if (cuentaId) condicionesCandidatos.push(eq(promocionesCandidatos.cuentaMlId, cuentaId));
    const condicionesAcciones = [eq(promocionesAcciones.empresaId, empresa.id)];
    if (cuentaId) condicionesAcciones.push(eq(promocionesAcciones.cuentaMlId, cuentaId));

    return Promise.all([
      tx
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
          maxDiscountedPrice: promocionesCandidatos.maxDiscountedPrice,
          gananciaEstimada: promocionesCandidatos.gananciaEstimada,
          cumpleReglas: promocionesCandidatos.cumpleReglas,
          motivoRevisarManual: promocionesCandidatos.motivoRevisarManual,
          actualizadoTs: promocionesCandidatos.actualizadoTs,
        })
        .from(promocionesCandidatos)
        .innerJoin(cuentasMl, eq(cuentasMl.id, promocionesCandidatos.cuentaMlId))
        .where(and(...condicionesCandidatos))
        .orderBy(desc(promocionesCandidatos.actualizadoTs)),
      tx
        .select({
          cuentaMlId: promocionesAcciones.cuentaMlId,
          itemId: promocionesAcciones.itemId,
          tipoPromocion: promocionesAcciones.tipoPromocion,
          estado: promocionesAcciones.estado,
          error: promocionesAcciones.error,
          creadoTs: promocionesAcciones.creadoTs,
        })
        .from(promocionesAcciones)
        .where(and(...condicionesAcciones))
        .orderBy(desc(promocionesAcciones.creadoTs))
        .limit(TOPE_ACCIONES_HISTORIAL),
    ]);
  });

  // accionesCrudas ya viene ordenada desc por creadoTs — la primera vez
  // que se ve una clave ES la más reciente.
  const ultimaAccionPorClave = new Map<string, { estado: EstadoDecision; error: string | null }>();
  for (const accion of accionesCrudas) {
    const clave = `${accion.cuentaMlId}:${accion.itemId}:${accion.tipoPromocion}`;
    if (!ultimaAccionPorClave.has(clave)) ultimaAccionPorClave.set(clave, { estado: accion.estado, error: accion.error });
  }

  // Bug real (rama fix-promociones-aprobadas-participando) — reportado
  // por Mateo en staging (cuenta sharel): "le doy Sí a una fila, queda
  // aprobada, pero en Aprobadas no aparece". Causa real confirmada en
  // el código: Dueño/Gerente tienen el permiso "ejecutar" por default
  // (lib/roles-plantillas.ts) — para esos roles, aprobar una fila la
  // manda DE UNA a ejecutarLoteDeAcciones (POST /acciones, MED 7,
  // decisión de Mateo desde el PR #304), que cambia `estado` a
  // "ejecutada" (o "fallida" si Mercado Libre la rechazó) casi al
  // instante. Esta pestaña solo reconocía `estado === "aceptada"` como
  // "aprobada" — una fila que pasó por las dos cosas de un saque
  // (aprobar + ejecutar) nunca llegaba a quedarse en "aceptada" el
  // tiempo suficiente para que el usuario la viera ahí: no aparecía en
  // Pendientes (ya no lo es) NI en Aprobadas (ya no es "aceptada").
  // "Aprobadas" ahora significa "alguien dijo que sí" sin importar si
  // ya se lanzó o no — igual que lo espera Mateo.
  const esAprobadaEnSentidoAmplio = (estado: EstadoDecision | null) => estado === "aceptada" || estado === "ejecutada" || estado === "fallida";

  const candidatosConDecision = candidatosCrudos.map((c) => {
    const ultima = ultimaAccionPorClave.get(`${c.cuentaMlId}:${c.itemId}:${c.tipoPromocion}`);
    const estadoDecision: EstadoDecision | null = ultima?.estado ?? null;
    return {
      ...c,
      estadoDecision,
      motivoRechazo: estadoDecision === "rechazada" ? (ultima?.error ?? null) : null,
      // Solo tiene sentido cuando Mercado Libre terminó rechazando una
      // fila que ya se había aprobado (y, para un Dueño/Gerente, se
      // intentó lanzar de una) — distinto de motivoRechazo, que es un
      // rechazo humano o automático ANTES de llegar a Mercado Libre.
      motivoFalla: estadoDecision === "fallida" ? (ultima?.error ?? null) : null,
    };
  });

  const esPendiente = (c: (typeof candidatosConDecision)[number]) => c.estadoDecision == null || c.estadoDecision === "pendiente";

  const conteos = {
    todas: candidatosConDecision.filter(esPendiente).length,
    cumplen: candidatosConDecision.filter((c) => esPendiente(c) && c.cumpleReglas).length,
    revisar: candidatosConDecision.filter((c) => esPendiente(c) && !c.cumpleReglas && !c.soloEnMl).length,
    "sin-minimo": candidatosConDecision.filter((c) => esPendiente(c) && c.precioMinimo == null).length,
    "solo-ml": candidatosConDecision.filter((c) => esPendiente(c) && c.soloEnMl).length,
    aprobadas: candidatosConDecision.filter((c) => esAprobadaEnSentidoAmplio(c.estadoDecision)).length,
    rechazadas: candidatosConDecision.filter((c) => c.estadoDecision === "rechazada").length,
  };

  let filas = candidatosConDecision;
  if (filtro === "aprobadas") {
    filas = filas.filter((c) => esAprobadaEnSentidoAmplio(c.estadoDecision));
  } else if (filtro === "rechazadas") {
    filas = filas.filter((c) => c.estadoDecision === "rechazada");
  } else {
    filas = filas.filter(esPendiente);
    if (filtro === "cumplen") filas = filas.filter((c) => c.cumpleReglas);
    if (filtro === "revisar") filas = filas.filter((c) => !c.cumpleReglas && !c.soloEnMl);
    if (filtro === "sin-minimo") filas = filas.filter((c) => c.precioMinimo == null);
    if (filtro === "solo-ml") filas = filas.filter((c) => c.soloEnMl);
  }

  return NextResponse.json({ filas, conteos });
}
