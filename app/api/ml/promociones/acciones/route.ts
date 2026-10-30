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

// Rama feat-promociones-aprobacion — "No" en una fila (o "Rechazar
// seleccionados" en el lote) nunca necesitó un valor de enum nuevo:
// `promocion_accion_estado` ya tenía "rechazada" desde la migración
// 0017 (pensado para cuando algo no pasa la validación del motor).
// Acá se reusa para una decisión humana explícita — nunca se valida
// ni se toca Mercado Libre para un rechazo, pase lo que pase con el
// motor; es una decisión final, no depende de si el motor seguiría
// recomendándolo.
//
// Rama feat-promociones-editar-precio, punto 2 — "volver_a_pendiente"
// tampoco necesitó nada nuevo: "pendiente" ya es el DEFAULT del enum
// (pensado para una fila que todavía no se decidió). Deshacer un
// rechazo inserta una fila nueva con ese estado — nunca se borra ni se
// edita la fila "rechazada" original (promociones_acciones no se toca
// así, es auditoría real) — la vista de candidatos (GET .../candidatos)
// siempre mira la ÚLTIMA fila por (cuenta,ítem,tipo), así que esta
// nueva fila "pendiente" devuelve el producto a la lista principal.
const DECISION_HUMANA = ["aprobar", "rechazar", "volver_a_pendiente"] as const;
type DecisionHumana = (typeof DECISION_HUMANA)[number];

type Decision = { candidatoId: string; accion: TipoAccion; decisionHumana: DecisionHumana; precioElegido?: number };

// MED 5 — ventana de idempotencia: un doble clic (o un reintento de
// red del navegador) no puede crear dos filas de historial para la
// misma cuenta+ítem+tipo+acción. 5 minutos es suficiente para cubrir
// un doble clic real sin esconder una decisión nueva y deliberada
// tomada minutos más tarde sobre el mismo producto. Solo aplica a
// "aprobar" — un rechazo nunca toca Mercado Libre, duplicarlo en el
// historial no tiene el mismo riesgo real.
const VENTANA_IDEMPOTENCIA_MS = 5 * 60 * 1000;

// LOW (review de Pablo, PR #304) — rechazo duplicado por doble clic:
// la UI ya deshabilita el botón "No" mientras responde, pero esto es
// la segunda red de seguridad del lado del servidor (un reintento de
// red, o dos pestañas abiertas). Ventana corta a propósito — nunca
// esconde un rechazo nuevo y deliberado sobre el mismo producto
// minutos después.
const VENTANA_IDEMPOTENCIA_RECHAZO_MS = 10 * 1000;

// Review de Pablo (PR #304) — un lote sin tope podía mandar miles de
// decisiones en un solo POST: cada una dispara varias consultas/escrituras
// reales (idempotencia, validarCandidatoParaEscritura, insert) — nunca
// pensado para eso. 200 alcanza de sobra para "Aprobar seleccionados"
// en una sola página de resultados; un lote más grande se divide en
// tandas desde la UI.
const TOPE_DECISIONES_POR_REQUEST = 200;

function parsearDecisiones(cuerpo: unknown): Decision[] | null {
  const lista = (cuerpo as { decisiones?: unknown })?.decisiones;
  if (!Array.isArray(lista) || lista.length === 0) return null;
  const resultado: Decision[] = [];
  for (const fila of lista) {
    const candidatoId = (fila as { candidatoId?: unknown })?.candidatoId;
    const accion = (fila as { accion?: unknown })?.accion;
    const decisionCruda = (fila as { decision?: unknown })?.decision;
    const precioElegidoCrudo = (fila as { precioElegido?: unknown })?.precioElegido;
    if (typeof candidatoId !== "string" || !PATRON_UUID.test(candidatoId)) return null;
    if (typeof accion !== "string" || !(TIPO_ACCION as readonly string[]).includes(accion)) return null;
    if (decisionCruda !== undefined && !(DECISION_HUMANA as readonly string[]).includes(decisionCruda as string)) return null;
    // Rama feat-promociones-editar-precio — precioElegido es opcional y
    // SOLO tiene sentido junto con "aprobar" (editar el precio de un
    // rechazo o de un "volver a pendiente" no significa nada); se
    // valida acá que sea un número finito, el resto (piso/techo reales)
    // lo valida validarCandidatoParaEscritura más abajo, nunca acá.
    if (precioElegidoCrudo !== undefined && typeof precioElegidoCrudo !== "number") return null;
    // Compatibilidad hacia atrás — "Aceptar todas las que cumplen" ya
    // mandaba {candidatoId, accion} sin "decision"; eso sigue
    // significando "aprobar", igual que siempre.
    const decisionHumana: DecisionHumana = decisionCruda === "rechazar" || decisionCruda === "volver_a_pendiente" ? decisionCruda : "aprobar";
    resultado.push({
      candidatoId,
      accion: accion as TipoAccion,
      decisionHumana,
      precioElegido: decisionHumana === "aprobar" && typeof precioElegidoCrudo === "number" ? precioElegidoCrudo : undefined,
    });
  }
  return resultado;
}

// Review de Pablo — dedupe por candidatoId: un doble clic rápido en el
// cliente (o un reintento de red) puede mandar el MISMO candidatoId
// dos veces dentro de un mismo lote — se queda con la primera decisión
// de cada uno, nunca procesa el mismo candidato dos veces en la misma
// tanda (distinto de MED 5, que es entre requests separados).
function dedupePorCandidatoId(decisiones: Decision[]): Decision[] {
  const vistos = new Set<string>();
  const resultado: Decision[] = [];
  for (const decision of decisiones) {
    if (vistos.has(decision.candidatoId)) continue;
    vistos.add(decision.candidatoId);
    resultado.push(decision);
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

  const listaCruda = (cuerpo as { decisiones?: unknown })?.decisiones;
  if (Array.isArray(listaCruda) && listaCruda.length > TOPE_DECISIONES_POR_REQUEST) {
    return NextResponse.json(
      { error: `No se pueden procesar más de ${TOPE_DECISIONES_POR_REQUEST} productos en un mismo lote — dividilo en tandas más chicas.` },
      { status: 400 }
    );
  }

  const decisionesParseadas = parsearDecisiones(cuerpo);
  if (!decisionesParseadas) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
  const decisiones = dedupePorCandidatoId(decisionesParseadas);

  // MED 4 — "Salir de la promo" todavía no se confirmó contra una
  // cuenta real de Mercado Libre (ver lib/ml/cliente.ts,
  // salirDePromocionMl). El botón ya está apagado en la UI; esto es la
  // segunda red de seguridad del lado del servidor.
  if (decisiones.some((d) => d.accion === "salir")) {
    return NextResponse.json({ error: "Salir de una promoción todavía no está confirmado contra Mercado Libre real." }, { status: 501 });
  }
  const decisionesEscribibles = decisiones as { candidatoId: string; accion: "participar" | "modificar"; decisionHumana: DecisionHumana; precioElegido?: number }[];
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

    if (decision.decisionHumana === "volver_a_pendiente") {
      // Deshacer un rechazo — ver el comentario completo arriba de
      // DECISION_HUMANA. Nunca valida ni toca Mercado Libre; solo dejar
      // la marca de que alguien volvió a poner esto en revisión.
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
            precioDespues: null,
            estado: "pendiente",
            aprobadoPor: usuario.id,
            aprobadoTs: new Date(),
            modoSimulacion,
            error: null,
          })
          .returning()
      );
      filasCreadas.push(fila);
      continue;
    }

    if (decision.decisionHumana === "rechazar") {
      // LOW — no-op si ya existe un rechazo MUY reciente para
      // exactamente esta combinación (ventana corta, ver arriba).
      const cutoffRechazo = new Date(Date.now() - VENTANA_IDEMPOTENCIA_RECHAZO_MS);
      const [rechazoExistente] = await dbComoEmpresa(empresa.id, (tx) =>
        tx
          .select()
          .from(promocionesAcciones)
          .where(
            and(
              eq(promocionesAcciones.cuentaMlId, candidato.cuentaMlId),
              eq(promocionesAcciones.itemId, candidato.itemId),
              eq(promocionesAcciones.tipoPromocion, candidato.tipoPromocion),
              eq(promocionesAcciones.accion, decision.accion),
              eq(promocionesAcciones.estado, "rechazada"),
              gte(promocionesAcciones.creadoTs, cutoffRechazo)
            )
          )
          .limit(1)
      );
      if (rechazoExistente) {
        filasCreadas.push(rechazoExistente);
        continue;
      }

      // Rechazo humano explícito ("No" en la fila, o "Rechazar
      // seleccionados" en el lote): SIEMPRE "rechazada", sin pasar por
      // validarCandidatoParaEscritura (no tiene sentido recalcular si
      // "cumpliría" algo que la persona ya decidió que no quiere) y sin
      // tocar Mercado Libre nunca.
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
            precioDespues: null,
            estado: "rechazada",
            aprobadoPor: usuario.id,
            aprobadoTs: new Date(),
            modoSimulacion,
            error: null,
          })
          .returning()
      );
      filasCreadas.push(fila);
      continue;
    }

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
    const validacion = await validarCandidatoParaEscritura(empresa.id, candidato, decision.accion, decision.precioElegido);
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
