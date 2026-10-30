import { and, eq } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { promocionesAcciones, promocionesCandidatos } from "@/db/schema";
import { conConcurrenciaLimitada } from "@/lib/concurrencia";
import type { PromocionCrudaMl } from "@/lib/ml/cliente";
import { modificarPromocionMl, motivoErrorEscrituraMl, participarPromocionMl } from "@/lib/ml/cliente";
import { obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import {
  calcularCandidatosItem,
  fechasParaParticipar,
  leerPisoYCostoFresco,
  leerReglasFrescasCuenta,
  TIPOS_SIN_ESCRITURA_API,
  type ItemConPromociones,
} from "@/lib/ml/promociones";

// Code review de Pablo — HIGH 2: "nunca confiar en accion/precioSugerido
// que manda el cliente para escribir en Mercado Libre". Este módulo es
// el ÚNICO lugar que decide si una acción de verdad se puede ejecutar
// — tanto app/api/ml/promociones/acciones/route.ts (aprobar, con
// ejecución inline si quien llama también tiene "ejecutar") como
// app/api/ml/promociones/acciones/ejecutar/route.ts (MED 7, el paso
// separado) llaman a las mismas funciones de acá. Nunca se duplica
// esta lógica entre las dos rutas.

type CandidatoFila = typeof promocionesCandidatos.$inferSelect;
type AccionFila = typeof promocionesAcciones.$inferSelect;

export type AccionEscribible = "participar" | "modificar";

export type ResultadoValidacion = { ok: true; deal: number } | { ok: false; motivo: string };

// Reconstruye el item/promo que calcularCandidatosItem espera a partir
// del snapshot guardado — nunca se vuelve a llamar a Mercado Libre acá
// (el snapshot ya tiene lo que el motor necesita); lo que SÍ se relee
// fresco son las reglas y el piso (ver abajo), nunca el snapshot.
function candidatoComoItem(candidato: CandidatoFila): ItemConPromociones {
  const promo: PromocionCrudaMl = {
    type: candidato.tipoPromocion,
    status: candidato.estadoMl,
    id: candidato.promotionIdMl,
    price: candidato.precioActual,
    original_price: candidato.precioOriginal,
    meli_percentage: candidato.esCompartida ? 1 : 0,
    max_discounted_price: candidato.maxDiscountedPrice,
  };
  return {
    itemId: candidato.itemId,
    cuentaMlId: candidato.cuentaMlId,
    nickname: "",
    tituloProducto: candidato.tituloProducto,
    thumbnail: candidato.thumbnail,
    skuCodigo: candidato.skuCodigo,
    tieneVariantes: candidato.tieneVariantes,
    // promociones_candidatos no guarda esto (review de Pablo, PR #304
    // — nunca se agregó columna, sin migración): da igual acá — con
    // tieneVariantes=true el motor ya fuerza cumpleReglas=false sin
    // mirar este flag, así que la revalidación sigue bloqueando el
    // write igual; solo cambia CUÁL de los dos motivos de variantes
    // se arma (el genérico, nunca el específico de SKU distinto).
    skuVariantesDistintas: false,
    promociones: [promo],
  };
}

// El corazón de HIGH 2 — recalcula TODO con el mismo motor que usa la
// búsqueda, con reglas y piso leídos de la base en este mismo instante
// (nunca el snapshot de promociones_candidatos, que puede ser de hace
// horas). cumpleReglas===true ya cubre, dentro del motor: variantes,
// tipos sin escritura por API, el gate de "compartida"/participarCompartidas,
// el tope de descuento y el precio máximo de la promoción puntual — no
// hace falta repetir esos checks acá, repetirlos sería la misma regla
// escrita dos veces y con el tiempo una de las dos copias queda vieja.
export async function validarCandidatoParaEscritura(
  empresaId: string,
  candidato: CandidatoFila,
  accionSolicitada: AccionEscribible,
  // Rama feat-promociones-editar-precio — precio elegido A MANO por un
  // humano para ESTE producto puntual (editando "Precio con promo" o
  // "% desc" en la fila, o el precio ya aprobado que se revalida justo
  // antes de lanzar — ver resolverYEjecutar más abajo). Cuando viene,
  // reemplaza el precioSugerido automático del motor como el número a
  // validar y mandar — nunca al revés, el motor nunca se entera de
  // "cuánto quiso" la persona, solo presta el piso/techo frescos.
  precioElegido?: number
): Promise<ResultadoValidacion> {
  if (candidato.tieneVariantes) {
    return { ok: false, motivo: "Este producto tiene variantes — se revisa a mano, nunca por esta vía." };
  }
  if (TIPOS_SIN_ESCRITURA_API.includes(candidato.tipoPromocion)) {
    return { ok: false, motivo: `El tipo "${candidato.tipoPromocion}" no se puede escribir por la API de Mercado Libre.` };
  }

  const [reglas, pisoYCosto] = await Promise.all([
    leerReglasFrescasCuenta(empresaId, candidato.cuentaMlId),
    leerPisoYCostoFresco(empresaId, candidato.skuCodigo),
  ]);

  const [recalculado] = calcularCandidatosItem(candidatoComoItem(candidato), reglas, pisoYCosto.precioMinimo, pisoYCosto.costo);
  const piso = pisoYCosto.precioMinimo;

  if (precioElegido !== undefined) {
    // Con un precio elegido a mano, los ÚNICOS frenos que siguen sin
    // negociarse son: variantes/tipo sin escritura (ya arriba), el
    // piso de Finanzas, el gate de "compartida"/participarCompartidas
    // y que la acción siga siendo la real (participar vs. modificar).
    // El tope de descuento de la cuenta (reglas.descuentoMaximoPct)
    // está pensado para el flujo AUTOMÁTICO ("Aceptar todas las que
    // cumplen"), nunca para bloquear una decisión humana explícita
    // sobre un producto puntual — por eso acá NO se repite ese check
    // (es la única diferencia real contra el camino de siempre, más
    // abajo).
    if (!recalculado) {
      return { ok: false, motivo: "No se pudo recalcular este producto — hace falta una búsqueda nueva." };
    }
    if (piso == null) {
      return { ok: false, motivo: recalculado.motivoRevisarManual ?? "Falta precio mínimo para este SKU en Finanzas — no se puede participar ni ajustar hasta que se cargue." };
    }
    if (recalculado.esCompartida && !reglas.participarCompartidas) {
      return { ok: false, motivo: "Promoción compartida con Mercado Libre (+Meli) — esta cuenta no tiene habilitado participar en estas." };
    }
    const accionEsperada: AccionEscribible = candidato.estadoMl === "candidate" ? "participar" : "modificar";
    if (accionEsperada !== accionSolicitada) {
      return { ok: false, motivo: "La acción solicitada ya no corresponde al estado actual de esta promoción en Mercado Libre." };
    }
    // Review de Pablo (PR #307) — "precio elegido" llega de un input de
    // texto en el navegador; nunca se asume que es un entero solo porque
    // el motor siempre redondea a pesos enteros del lado de la UI
    // (`precioDesdeDescuento`, calculosFila.ts) — un decimal cargado a
    // mano (ej. "90000.5") se rechaza explícito, nunca se trunca ni se
    // redondea en silencio antes de mandarlo a Mercado Libre.
    if (!Number.isFinite(precioElegido) || !Number.isInteger(precioElegido) || precioElegido <= 0 || precioElegido < piso) {
      return { ok: false, motivo: "El precio elegido tiene que ser un número en pesos enteros, mayor que cero y nunca por debajo del piso de Finanzas." };
    }
    // Review de Pablo (PR #307) — mismo criterio que la UI (rangoEdicion,
    // calculosFila.ts): el techo real es el MÁS CHICO entre lo que
    // Mercado Libre permite para esta promoción puntual
    // (maxDiscountedPrice) y el precio de hoy — antes se usaba
    // maxDiscountedPrice ?? precioOriginal, que si ML manda un
    // maxDiscountedPrice MÁS ALTO que el precio de hoy (promoción vieja,
    // precio subido después) dejaba pasar un "descuento" más caro que el
    // precio original.
    const techos = [recalculado.maxDiscountedPrice, recalculado.precioOriginal].filter((v): v is number => v != null);
    const techo = techos.length > 0 ? Math.min(...techos) : null;
    if (techo != null && precioElegido > techo) {
      return { ok: false, motivo: `El precio elegido supera el máximo que permite esta promoción puntual ($${Math.round(techo).toLocaleString("es-CO")}).` };
    }
    return { ok: true, deal: precioElegido };
  }

  // Camino de siempre, sin precio elegido a mano — cumpleReglas===true
  // ya cubre, DENTRO del motor: variantes, tipos sin escritura, el
  // gate de "compartida", el tope de descuento y el precio máximo de
  // la promoción puntual — no hace falta repetir esos checks acá.
  if (!recalculado || !recalculado.cumpleReglas) {
    return { ok: false, motivo: recalculado?.motivoRevisarManual ?? "Ya no cumple las reglas de esta cuenta — hace falta una búsqueda nueva." };
  }
  if (recalculado.accionSugerida !== accionSolicitada) {
    return { ok: false, motivo: "La acción solicitada ya no corresponde al estado actual de esta promoción en Mercado Libre." };
  }

  const { precioSugerido: deal } = recalculado;
  // LOW 10 — guard explícito y final, nunca implícito en el tipo: sin
  // importar qué devolvió el motor, un NaN/0/negativo o por debajo del
  // piso jamás sale hacia un POST/PUT a Mercado Libre.
  if (piso == null || deal == null || !Number.isFinite(deal) || deal <= 0 || deal < piso) {
    return { ok: false, motivo: "El precio calculado no es válido o quedó por debajo del piso — no se escribe en Mercado Libre." };
  }

  return { ok: true, deal };
}

// MED 6 — "no escribas si el precio actual cambió mucho frente al
// snapshot". Criterio documentado: más de 2% de diferencia entre el
// precio que se capturó al aprobar (precioAntes) y el que tiene AHORA
// el candidato en la base (puede haberse refrescado con una búsqueda
// nueva entre el aprobar y el ejecutar) frena la ejecución — un hueco
// de pocos puntos puede ser redondeo o un ajuste menor de Mercado
// Libre; un salto mayor señala que el mercado cambió de verdad desde
// la aprobación y hace falta mirarlo de nuevo, no ejecutar a ciegas
// sobre un precio viejo.
const TOLERANCIA_DERIVA_PRECIO = 0.02;

export function precioCambioDemasiado(precioAntes: number | null, precioActualFresco: number | null): boolean {
  if (precioAntes == null || precioActualFresco == null) return false;
  if (precioAntes === 0) return precioActualFresco !== 0;
  return Math.abs(precioActualFresco - precioAntes) / Math.abs(precioAntes) > TOLERANCIA_DERIVA_PRECIO;
}

export type ResultadoEjecucion = { estado: "ejecutada" | "fallida"; error: string | null; resultadoMl: unknown };

// Punto 5 original ("si una cuenta falla, se detiene esa cuenta, las
// demás siguen") + LOW 11: "salir" queda anotado para cuando se
// reactive, nunca se intenta de verdad contra Mercado Libre todavía.
async function resolverYEjecutar(empresaId: string, fila: AccionFila, token: string): Promise<ResultadoEjecucion> {
  if (fila.accion === "salir") {
    // MED 4 / LOW 11 — "Salir de la promo" nunca se confirmó contra una
    // cuenta real (lib/ml/cliente.ts, salirDePromocionMl). La ruta de
    // aprobar ya rechaza esta acción con 501 antes de llegar a crear la
    // fila — este bloque es la segunda red de seguridad (por si alguna
    // vez queda una fila vieja "aceptada" con accion="salir" de antes
    // de ese cambio) y queda documentado para cuando se reactive: habrá
    // que (1) confirmar el DELETE en vivo contra una cuenta de prueba,
    // (2) sacar este bloqueo, (3) sumar "salir" a validarCandidatoParaEscritura.
    return { estado: "fallida", error: "Salir de una promoción todavía no está confirmado contra Mercado Libre real.", resultadoMl: null };
  }
  const accion: AccionEscribible = fila.accion;

  const [candidatoActual] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select()
      .from(promocionesCandidatos)
      .where(
        and(
          eq(promocionesCandidatos.cuentaMlId, fila.cuentaMlId),
          eq(promocionesCandidatos.itemId, fila.itemId),
          eq(promocionesCandidatos.tipoPromocion, fila.tipoPromocion)
        )
      )
  );
  if (!candidatoActual) {
    return { estado: "fallida", error: "El candidato ya no existe — la promoción cambió o se cerró desde la última búsqueda.", resultadoMl: null };
  }

  if (
    precioCambioDemasiado(
      fila.precioAntes != null ? Number(fila.precioAntes) : null,
      candidatoActual.precioActual != null ? Number(candidatoActual.precioActual) : null
    )
  ) {
    return {
      estado: "fallida",
      error: `El precio cambió más del ${Math.round(TOLERANCIA_DERIVA_PRECIO * 100)}% desde que se aprobó esta acción — se frenó, hace falta una búsqueda nueva.`,
      resultadoMl: null,
    };
  }

  // Rama feat-promociones-editar-precio — se revalida fresco el precio
  // QUE DE VERDAD SE APROBÓ (fila.precioDespues), nunca uno recalculado
  // de cero acá: así lo que se lanza es exactamente lo que la persona
  // vio y aprobó (o editó a mano), siempre y cuando siga siendo válido
  // contra el piso/techo frescos — precioCambioDemasiado, arriba, ya
  // frena si el precio de mercado se movió mucho desde la aprobación.
  const precioAprobado = fila.precioDespues != null ? Number(fila.precioDespues) : undefined;
  const validacion = await validarCandidatoParaEscritura(empresaId, candidatoActual, accion, precioAprobado);
  if (!validacion.ok) {
    return { estado: "fallida", error: validacion.motivo, resultadoMl: null };
  }

  let respuestaMl: { ok: boolean; status: number; textoCrudo: string };
  try {
    if (accion === "participar") {
      // El snapshot nunca guardó las fechas reales de la promoción de
      // Mercado Libre (solo lo que hace falta para decidir el precio)
      // — fechasParaParticipar con un objeto vacío cae directo al
      // respaldo real (hoy → fin de mes).
      const { fechaInicio, fechaFin } = fechasParaParticipar({});
      respuestaMl = await participarPromocionMl(fila.itemId, token, {
        promotion_id: fila.promotionIdMl ?? "",
        promotion_type: fila.tipoPromocion,
        deal_price: validacion.deal,
        start_date: fechaInicio,
        finish_date: fechaFin,
      });
    } else {
      respuestaMl = await modificarPromocionMl(fila.itemId, token, {
        promotion_id: fila.promotionIdMl ?? "",
        promotion_type: fila.tipoPromocion,
        deal_price: validacion.deal,
      });
    }
  } catch (error) {
    return { estado: "fallida", error: error instanceof Error ? error.message.slice(0, 400) : "No se pudo ejecutar.", resultadoMl: null };
  }

  // Punto 4 (rama fix-promociones-aprobar-no-ejecuta) — bug real
  // diagnosticado con el 400 de VITALCLOROFULL: el cuerpo real de la
  // respuesta de Mercado Libre YA llegaba hasta acá (quedaba guardado
  // en resultadoMl.respuesta), pero `error` — el único campo que
  // muestra la UI (Historial, chip con title) — se llenaba con un
  // genérico "Mercado Libre respondió 400.", inútil para diagnosticar
  // nada. Ahora se extrae el motivo real (cause/message del cuerpo) y,
  // si Mercado Libre no mandó ninguno de los dos, se cae al genérico
  // de siempre (nunca deja `error` vacío en una fila fallida).
  const motivoReal = respuestaMl.ok ? null : motivoErrorEscrituraMl(respuestaMl.textoCrudo);
  return {
    estado: respuestaMl.ok ? "ejecutada" : "fallida",
    error: respuestaMl.ok ? null : motivoReal ?? `Mercado Libre respondió ${respuestaMl.status}.`,
    resultadoMl: { ok: respuestaMl.ok, status: respuestaMl.status, respuesta: respuestaMl.textoCrudo.slice(0, 500) },
  };
}

async function marcarResultado(empresaId: string, filaId: string, usuarioId: string, resultado: ResultadoEjecucion): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .update(promocionesAcciones)
      .set({ estado: resultado.estado, ejecutadoPor: usuarioId, ejecutadoTs: new Date(), resultadoMl: resultado.resultadoMl, error: resultado.error })
      .where(eq(promocionesAcciones.id, filaId))
  );
}

// Punto 3 (rama fix-promociones-aprobar-no-ejecuta) — tope de
// concurrencia real: antes, TODAS las cuentas del lote arrancaban en
// paralelo sin ningún límite (un lote con muchas cuentas podía
// disparar decenas de requests simultáneos contra la API de Mercado
// Libre de una sola vez). Mismo helper ya usado en
// buscarPromocionesMultiCuenta.ts y promocionesParticipando.ts
// (lib/concurrencia.ts) — máximo 4 CUENTAS procesándose a la vez;
// dentro de cada cuenta sigue siendo estrictamente secuencial, fila
// por fila, cortando esa cuenta puntual en la primera falla (sin
// tocar esto: necesita orden real, no se puede paralelizar sin perder
// el corte temprano).
const TOPE_CONCURRENCIA_CUENTAS = 4;

// Punto de entrada único para ejecutar un lote de filas "aceptada" de
// verdad contra Mercado Libre — agrupa por cuenta (token una vez por
// cuenta) y corta esa cuenta puntual ante la primera falla, nunca el
// resto del lote.
export async function ejecutarLoteDeAcciones(empresaId: string, usuarioId: string, filas: AccionFila[]): Promise<void> {
  const porCuenta = new Map<string, AccionFila[]>();
  for (const fila of filas) {
    if (!porCuenta.has(fila.cuentaMlId)) porCuenta.set(fila.cuentaMlId, []);
    porCuenta.get(fila.cuentaMlId)!.push(fila);
  }

  await conConcurrenciaLimitada([...porCuenta.entries()], TOPE_CONCURRENCIA_CUENTAS, async ([cuentaMlId, filasCuenta]) => {
    let token: string;
    try {
      token = await obtenerAccessTokenVigente(empresaId, cuentaMlId);
    } catch (error) {
      const motivo = error instanceof Error ? error.message : "No se pudo obtener el token.";
      await Promise.all(filasCuenta.map((f) => marcarResultado(empresaId, f.id, usuarioId, { estado: "fallida", error: motivo, resultadoMl: null })));
      return;
    }

    for (const fila of filasCuenta) {
      const resultado = await resolverYEjecutar(empresaId, fila, token);
      await marcarResultado(empresaId, fila.id, usuarioId, resultado);
      if (resultado.estado !== "ejecutada") break; // esta cuenta se detiene; el resto del lote sigue (hasta 4 cuentas a la vez)
    }
  });
}
