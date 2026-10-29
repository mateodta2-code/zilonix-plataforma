import { and, eq, gte, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { requierePermiso } from "@/lib/permisos";
import { tienePermiso } from "@/lib/roles-plantillas";
import { ejecutarLoteDeAcciones, validarCandidatoParaEscritura } from "@/lib/ml/promocionesEjecucion";
import { urlPublicaBase } from "@/lib/url-publica";
import { PATRON_UUID, respuestaSiOrigenInvalido, respuestaSiSinPermiso, resolverSesionYEmpresa } from "../_ayudantes";

// Rama feat-promociones, punto 3/5 — "nada se aplica en ML sin ese
// clic de confirmación". Un solo endpoint para el lote completo:
// SIEMPRE exige "aprobar" (marca las acciones como aceptadas y queda
// en el historial); si quien llama TAMBIÉN tiene "ejecutar", sigue de
// una vez y dispara el cambio real contra Mercado Libre — si no, el
// lote queda "aceptada", pendiente de que alguien con permiso de
// ejecutar lo dispare después desde POST .../acciones/ejecutar (MED 7,
// 2 pasos humanos reales, decisión de Mateo). "modoSimulacion" nunca
// llega a tocar Mercado Libre, pase lo que pase con el permiso de
// ejecutar — calcula y deja registro igual, para que se vea qué se
// habría hecho.
//
// Punto 5 — "si una cuenta falla al aplicar, esa cuenta se detiene y
// las demás siguen": el corte es por CUENTA, nunca global (ver
// lib/ml/promocionesEjecucion.ts, ejecutarLoteDeAcciones).
//
// Code review de Pablo — HIGH 2: esta ruta NUNCA confía en
// candidato.precioSugerido/cumpleReglas del snapshot ni en nada que
// mande el cliente más allá de candidatoId/accion — todo decision de
// dinero se recalcula fresco en lib/ml/promocionesEjecucion.ts, con
// reglas y piso leídos de la base en este mismo instante.
const TIPO_ACCION = ["participar", "modificar", "salir"] as const;
type TipoAccion = (typeof TIPO_ACCION)[number];

type Decision = { candidatoId: string; accion: TipoAccion };

// MED 5 — ventana de idempotencia: un doble clic (o un reintento de
// red del navegador) no puede crear dos filas de historial para la
// misma cuenta+ítem+tipo+acción. 5 minutos es suficiente para cubrir
// un doble clic real sin esconder una decisión nueva y deliberada
// tomada minutos más tarde sobre el mismo producto.
const VENTANA_IDEMPOTENCIA_MS = 5 * 60 * 1000;

function parsearDecisiones(cuerpo: unknown): Decision[] | null {
  const lista = (cuerpo as { decisiones?: unknown })?.decisiones;
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const resultado: Decision[] = [];
  for (const fila of lista) {
    const candidatoId = (fila as { candidatoId?: unknown })?.candidatoId;
    const accion = (fila as { accion?: unknown })?.accion;
    if (typeof candidatoId !== "string" || !PATRON_UUID.test(candidatoId)) return null;
    if (typeof accion !== "string" || !(TIPO_ACCION as readonly string[]).includes(accion)) return null;
    resultado.push({ candidatoId, accion: accion as TipoAccion });
  }
  return resultado;
}

export async function POST(request: Request) {
  const base = urlPublicaBase();
  const respuestaOrigen = respuestaSiOrigenInvalido(request, new URL(base).origin);
  if (respuestaOrigen) return respuestaOrigen;

  const sesion = await resolverSesionYEmpresa();
  if (sesion instanceof NextResponse) return sesion;
  const { usuario, empresa } = sesion;

  let miMembresia;
  try {
    miMembresia = await requierePermiso(usuario.id, empresa.id, "promociones", "aprobar");
  } catch (error) {
    const respuestaPermiso = respuestaSiSinPermiso(error);
    if (respuestaPermiso) return respuestaPermiso;
    throw error;
  }
  const puedeEjecutar = tienePermiso(miMembresia.permisos, "promociones", "ejecutar");

  let cuerpo: unknown;
  try {
    cuerpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  }
  const decisiones = parsearDecisiones(cuerpo);
  if (!decisiones) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });

  // MED 4 — "Salir de la promo" todavía no se confirmó contra una
  // cuenta real de Mercado Libre (ver lib/ml/cliente.ts,
  // salirDePromocionMl). El botón ya está apagado en la UI; esto es la
  // segunda red de seguridad del lado del servidor.
  if (decisiones.some((d) => d.accion === "salir")) {
    return NextResponse.json({ error: "Salir de una promoción todavía no está confirmado contra Mercado Libre real." }, { status: 501 });
  }
  const decisionesEscribibles = decisiones as { candidatoId: string; accion: "participar" | "modificar" }[];
  const modoSimulacion = (cuerpo as { modoSimulacion?: unknown })?.modoSimulacion === true;

  const candidatoIds = decisionesEscribibles.map((d) => d.candidatoId);
  const candidatos = await dbComoEmpresa(empresa.id, (tx) =>
    tx.select().from(promocionesCandidatos).where(inArray(promocionesCandidatos.id, candidatoIds))
  );
  const candidatoPorId = new Map(candidatos.map((c) => [c.id, c]));

  const filasCreadas: (typeof promocionesAcciones.$inferSelect)[] = [];
  for (const decision of decisionesEscribibles) {
    const candidato = candidatoPorId.get(decision.candidatoId);
    if (!candidato) continue; // candidatoId que no existe o es de otra empresa (RLS) — se ignora, nunca rompe el resto

    // MED 5 — no-op si ya existe una fila reciente aceptada/ejecutada
    // para exactamente esta combinación.
    const cutoff = new Date(Date.now() - VENTANA_IDEMPOTENCIA_MS);
    const [existente] = await dbComoEmpresa(empresa.id, (tx) =>
      tx
        .select()
        .from(promocionesAcciones)
        .where(
          and(
            eq(promocionesAcciones.cuentaMlId, candidato.cuentaMlId),
            eq(promocionesAcciones.itemId, candidato.itemId),
            eq(promocionesAcciones.tipoPromocion, candidato.tipoPromocion),
            eq(promocionesAcciones.accion, decision.accion),
            inArray(promocionesAcciones.estado, ["aceptada", "ejecutada"]),
            gte(promocionesAcciones.creadoTs, cutoff)
          )
        )
        .limit(1)
    );
    if (existente) {
      filasCreadas.push(existente);
      continue;
    }

    // HIGH 2 — nunca se confía en candidato.cumpleReglas/precioSugerido
    // del snapshot: se recalcula fresco antes de aceptar la acción.
    const validacion = await validarCandidatoParaEscritura(empresa.id, candidato, decision.accion);
    const [fila] = await dbComoEmpresa(empresa.id, (tx) =>
      tx
        .insert(promocionesAcciones)
        .values({
          empresaId: empresa.id,
          cuentaMlId: candidato.cuentaMlId,
          itemId: candidato.itemId,
          tituloProducto: candidato.tituloProducto,
          tipoPromocion: candidato.tipoPromocion,
          promotionIdMl: candidato.promotionIdMl,
          accion: decision.accion,
          precioAntes: candidato.precioActual,
          precioDespues: validacion.ok ? String(validacion.deal) : null,
          estado: validacion.ok ? "aceptada" : "rechazada",
          aprobadoPor: usuario.id,
          aprobadoTs: new Date(),
          modoSimulacion,
          error: validacion.ok ? null : validacion.motivo,
        })
        .returning()
    );
    filasCreadas.push(fila);
  }

  const aEjecutar = filasCreadas.filter((f) => f.estado === "aceptada");

  if (modoSimulacion || !puedeEjecutar || aEjecutar.length === 0) {
    return NextResponse.json({ ok: true, acciones: filasCreadas, ejecutado: false });
  }

  await ejecutarLoteDeAcciones(empresa.id, usuario.id, aEjecutar);

  const idsEjecutados = aEjecutar.map((f) => f.id);
  const filasFinal = await dbComoEmpresa(empresa.id, (tx) =>
    tx.select().from(promocionesAcciones).where(inArray(promocionesAcciones.id, idsEjecutados))
  );
  const filaFinalPorId = new Map(filasFinal.map((f) => [f.id, f]));

  return NextResponse.json({ ok: true, acciones: filasCreadas.map((f) => filaFinalPorId.get(f.id) ?? f), ejecutado: true });
}
