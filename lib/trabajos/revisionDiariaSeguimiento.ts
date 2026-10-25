import { and, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, seguimientoAlertas, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { leerFotoSeguimiento, type SeguimientoParaLeer } from "@/lib/seguimiento/lector";
import { compararFotos, type FotoComparable } from "@/lib/seguimiento/alertas";
import { franjaBogota, limiteFranjaDeHoy } from "@/lib/seguimiento/franja";
import { NOMBRE_PENDIENTE_PRIMERA_REVISION, resolverNombre } from "@/lib/seguimiento/seguimientos";

// Issue #175 — regla de CLAUDE.md: "toda tarea en segundo plano vive
// en lib/trabajos/". Mismo patrón que lib/ml/trabajador.ts (tarea
// 2.4): dbTrabajadorSeguimiento (rol de base restringido, SELECT/
// UPDATE solo en seguimientos_ml) enumera seguimientos de CUALQUIER
// empresa; apenas se sabe a qué empresa pertenece uno, el resto
// (cuenta, token, foto, alertas) pasa por dbComoEmpresa()/app_user,
// como cualquier consulta de negocio real.
const TAMAÑO_LOTE = 50;

// "Respeta los límites de ML: pausa entre llamadas" — entre CADA
// seguimiento procesado (lib/ml/cliente.ts ya pacea sus propias
// llamadas múltiples dentro de un mismo seguimiento, ej. los lotes de
// /items?ids= de una tienda).
const PAUSA_ENTRE_SEGUIMIENTOS_MS = 500;

// "Reintento con espera en 429" — 3 reintentos con espera creciente
// antes de darse por vencido con ESE seguimiento puntual (nunca tumba
// el lote entero, igual que procesarAvisosPendientes).
const REINTENTOS_429 = 3;
const ESPERA_BASE_429_MS = 2_000;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type ResultadoRevisionDiaria = {
  activos: number;
  procesados: number;
  // Issue #196 — distinto de "procesados": el índice único
  // seguimiento_id+fecha bloqueó el insert porque YA había una foto de
  // hoy para este seguimiento (corrida manual repetida, o una carrera
  // entre dos corridas del cron a la vez) — nunca se escribió nada
  // nuevo, pero tampoco fue un error real (ver revisarUnSeguimiento).
  saltados: number;
  fallidos: number;
  alertasCreadas: number;
};

// Solo la FECHA (medianoche UTC) — "misma fecha" es la clave real de
// "misma foto del día", nunca el instante exacto en que corrió el
// trabajo (ver el comentario de seguimiento_fotos.fecha en db/schema.ts).
// Issue #244 — acepta `ahora` (default: el reloj real) para poder
// probar el corte de franja con un instante fijo, sin depender de en
// qué momento del día corra la prueba.
function fechaDeHoy(ahora: Date = new Date()): Date {
  const hoy = new Date(ahora);
  hoy.setUTCHours(0, 0, 0, 0);
  return hoy;
}

// Issue real: el lote tomaba siempre los mismos 50 sin ningún orden —
// un seguimiento 51 nunca llegaba a revisarse si la empresa tenía más
// de un lote. Dos correcciones, exportada aparte para poder probar el
// orden y el filtro solos:
// - Filtro: nunca un seguimiento ya eliminado, y solo los que NO se
//   revisaron todavía en la franja actual (ultima_revision_ts antes
//   del límite de la franja de hoy, o null — nunca revisado) — uno ya
//   revisado en ESTA franja no vuelve a entrar en la cola aunque el
//   cron corra varias veces (ver docs/cron-seguimiento.md).
// - Orden: ASC NULLS FIRST por ultima_revision_ts — el que nunca se
//   revisó, o el que hace más tiempo que no se revisa, entra primero
//   al lote. Así, entre varias corridas de la misma franja, el lote
//   siguiente SÍ llega a los que quedaron afuera del anterior, nunca
//   repite los mismos primeros 50 una y otra vez.
//
// Issue #244 — "2 fotos al día": en franja "manana" el límite sigue
// siendo la medianoche de hoy (idéntico al comportamiento de siempre:
// una sola pasada). En franja "tarde" el límite se corre hasta el
// corte de hoy (limiteFranjaDeHoy) — eso deja pendiente, de nuevo, a
// quien YA tuvo su pasada de "manana" pero todavía no la de "tarde".
// Antes, la 2ª pasada del día se saltaba siempre ("ya revisado hoy"
// bloqueaba cualquier otra franja); ahora solo se salta si ya tuvo la
// franja ACTUAL, nunca una franja anterior del mismo día.
export async function obtenerSeguimientosPendientesDeHoy(ahora: Date = new Date()): Promise<(typeof seguimientosMl.$inferSelect)[]> {
  const hoy = fechaDeHoy(ahora);
  const limite = franjaBogota(ahora) === "tarde" ? limiteFranjaDeHoy(hoy) : hoy;
  return dbTrabajadorSeguimiento
    .select()
    .from(seguimientosMl)
    .where(and(isNull(seguimientosMl.eliminadoTs), or(isNull(seguimientosMl.ultimaRevisionTs), lt(seguimientosMl.ultimaRevisionTs, limite))))
    .orderBy(sql`${seguimientosMl.ultimaRevisionTs} ASC NULLS FIRST`)
    .limit(TAMAÑO_LOTE);
}

export async function revisarSeguimientosDelDia(ahora: Date = new Date()): Promise<ResultadoRevisionDiaria> {
  const activos = await obtenerSeguimientosPendientesDeHoy(ahora);

  let procesados = 0;
  let saltados = 0;
  let fallidos = 0;
  let alertasCreadas = 0;

  for (let i = 0; i < activos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_SEGUIMIENTOS_MS);
    const seguimiento = activos[i];
    try {
      const resultado = await revisarUnSeguimiento(seguimiento, ahora);
      if (resultado.saltado) saltados += 1;
      else procesados += 1;
      alertasCreadas += resultado.alertasCreadas;
      // Issue #244 — bug real de CI: acá tenía que ir el MISMO `ahora`
      // que ya se usó arriba para decidir la franja y escribir la
      // foto, nunca un `new Date()` aparte (el reloj real del runner,
      // en un test con un `ahora` fijo, puede caer en otra franja y
      // romper el filtro de "pendiente" de la próxima corrida).
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: ahora }).where(eq(seguimientosMl.id, seguimiento.id));
    } catch (error) {
      // Un seguimiento que falla (cuenta sin token vigente, Mercado
      // Libre caído, etc.) no debe tumbar el lote entero — mismo
      // criterio que procesarAvisosPendientes (lib/ml/trabajador.ts).
      fallidos += 1;
      console.error(`Seguimiento ${seguimiento.id} (${seguimiento.tipo}) no se pudo revisar:`, error instanceof Error ? error.message : error);
      // Bug real (issue #175): si un fallido NUNCA marca
      // ultima_revision_ts, el orden ASC NULLS FIRST lo deja al frente
      // del lote para siempre — ahoga los cupos en cada corrida
      // siguiente (encontrado en CI: seguimientos viejos sin cuenta ML
      // conectada, ahogando el lote de 50 y haciendo timeout). Marcarlo
      // igual que un éxito lo rota al final; el filtro "ya revisado en
      // esta franja" evita que la MISMA corrida (o una corrida
      // posterior de la misma franja) lo vuelva a tomar, pero en la
      // próxima franja sí se reintenta. Mismo `ahora` que arriba, nunca
      // un `new Date()` aparte (ver el comentario del caso feliz).
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: ahora }).where(eq(seguimientosMl.id, seguimiento.id));
    }
  }

  // Issue #196 — un solo log por LOTE (nunca por seguimiento, eso ya
  // lo hace el console.error de arriba), con los conteos nada más —
  // nunca un id de seguimiento, un token ni el cuerpo de una respuesta
  // de Mercado Libre. Sirve para confirmar en los logs del cron (acá y
  // en producción) que el lote corrió y qué tan ocupado estaba, sin
  // tener que sumar a mano las líneas de error de arriba.
  console.log(
    `[lib/trabajos/revisionDiariaSeguimiento] lote del día: ${activos.length} activos, ${procesados} procesados, ${saltados} saltados, ${fallidos} con error, ${alertasCreadas} alertas creadas.`
  );

  return { activos: activos.length, procesados, saltados, fallidos, alertasCreadas };
}

// Exportada para poder probar el reintento con espera en 429 sola,
// mockeando lib/seguimiento/lector.ts con vi.useFakeTimers() — sin
// Postgres real, que no tiene nada que ver con esta lógica puntual.
export async function leerConReintento429(seguimiento: SeguimientoParaLeer, token: string, cuentaIdExterna: string) {
  for (let intento = 0; ; intento++) {
    try {
      return await leerFotoSeguimiento(seguimiento, token, cuentaIdExterna);
    } catch (error) {
      if (error instanceof LimiteMercadoLibreError && intento < REINTENTOS_429) {
        await esperar(ESPERA_BASE_429_MS * (intento + 1));
        continue;
      }
      throw error;
    }
  }
}

function aFotoComparable(fila: typeof seguimientoFotos.$inferSelect): FotoComparable {
  return {
    precio: fila.precio != null ? Number(fila.precio) : null,
    inventarioDisponible: fila.inventarioDisponible,
    vendidos: fila.vendidos,
    estado: fila.estado,
    enCatalogo: fila.enCatalogo,
    ganaBotonCompra: fila.ganaBotonCompra,
    publicaciones: fila.publicaciones,
  };
}

type ResultadoUnSeguimiento = { saltado: boolean; alertasCreadas: number };

// `saltado: true` SOLO cuando el índice único seguimiento_id+fecha+franja
// bloqueó el insert porque ya había una foto de ESTA franja hoy (ver el
// onConflictDoNothing más abajo) — nunca se escribió nada nuevo.
// `saltado: false` con `alertasCreadas: 0` es un caso DISTINTO: la
// foto de esta franja SÍ se escribió (sí fue "procesado"), simplemente
// no hay ninguna foto anterior con qué compararla todavía (primera
// foto de este seguimiento) — no hay alertas que generar, pero no es
// un salto.
async function revisarUnSeguimiento(seguimiento: typeof seguimientosMl.$inferSelect, ahora: Date = new Date()): Promise<ResultadoUnSeguimiento> {
  const cuenta = await obtenerCuentaMlActiva(seguimiento.empresaId);
  if (!cuenta) throw new Error("La empresa no tiene ninguna cuenta de Mercado Libre conectada.");

  const [cuentaFila] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx.select({ cuentaIdExterna: cuentasMl.cuentaIdExterna }).from(cuentasMl).where(eq(cuentasMl.id, cuenta.id))
  );
  const token = await obtenerAccessTokenVigente(seguimiento.empresaId, cuenta.id);

  // Issue #201 — "al agregar o en la primera revisión, guardar el
  // nombre real": si agregarSeguimiento() no pudo resolverlo ese
  // instante (token recién emitido, un 403/5xx puntual de Mercado
  // Libre), queda el placeholder — se reintenta ACÁ, con un token ya
  // confirmado vigente, en cada revisión diaria mientras siga
  // pendiente. Nunca se reintenta si ya hay un nombre real, para no
  // gastar una llamada a ML de más todos los días.
  if (seguimiento.nombre === NOMBRE_PENDIENTE_PRIMERA_REVISION) {
    const nombreResuelto = await resolverNombre(seguimiento.tipo, seguimiento.recursoMl, seguimiento.mlIdExterno, token);
    if (nombreResuelto !== NOMBRE_PENDIENTE_PRIMERA_REVISION) {
      await dbComoEmpresa(seguimiento.empresaId, (tx) => tx.update(seguimientosMl).set({ nombre: nombreResuelto }).where(eq(seguimientosMl.id, seguimiento.id)));
    }
  }

  const datos = await leerConReintento429(seguimiento, token, cuentaFila.cuentaIdExterna);

  const hoy = fechaDeHoy(ahora);
  const franja = franjaBogota(ahora);

  // Issue #244 — antes comparaba SOLO contra la foto de un día
  // anterior (`fecha < hoy`): con una sola foto por día alcanzaba,
  // pero con 2 pasadas la de la tarde volvía a compararse contra
  // "ayer" en vez de contra la de la mañana de HOY — generaba la MISMA
  // alerta duplicada dos veces el mismo día (ej. "bajó el precio" a
  // las 9am Y otra vez a las 6pm, aunque no cambió nada entre medio).
  // Ahora es la foto real más reciente que ya exista, sea de hoy
  // temprano o de un día previo — así la pasada de la tarde compara
  // contra la de la mañana cuando las dos existen (alerta real si algo
  // cambió en el día, ninguna si no cambió), y contra la de ayer
  // cuando todavía no hay foto de hoy (comportamiento de siempre).
  // desc(creadoTs) como segundo criterio: con dos fotos del mismo día
  // (misma `fecha`), decide cuál es la más nueva de verdad.
  const [fotoAnterior] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx
      .select()
      .from(seguimientoFotos)
      .where(eq(seguimientoFotos.seguimientoId, seguimiento.id))
      .orderBy(desc(seguimientoFotos.fecha), desc(seguimientoFotos.creadoTs))
      .limit(1)
  );

  const [fotoNueva] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx
      .insert(seguimientoFotos)
      .values({
        empresaId: seguimiento.empresaId,
        seguimientoId: seguimiento.id,
        fecha: hoy,
        franja,
        precio: datos.precio != null ? String(datos.precio) : null,
        precioAnterior: datos.precioAnterior != null ? String(datos.precioAnterior) : null,
        inventarioDisponible: datos.inventarioDisponible,
        inventarioAproximado: datos.inventarioAproximado,
        vendidos: datos.vendidos,
        estado: datos.estado,
        enCatalogo: datos.enCatalogo,
        ganaBotonCompra: datos.ganaBotonCompra,
        esFull: datos.esFull,
        esEnvioGratis: datos.esEnvioGratis,
        publicaciones: datos.publicaciones,
      })
      // Si el trabajo ya corrió en ESTA franja hoy para este
      // seguimiento (una corrida manual repetida, o el cron disparado
      // dos veces dentro de la misma franja), el índice único
      // seguimiento_id+fecha+franja lo bloquea — onConflictDoNothing
      // en vez de dejar que la excepción tumbe el lote entero.
      .onConflictDoNothing()
      .returning()
  );
  if (!fotoNueva) return { saltado: true, alertasCreadas: 0 };
  if (!fotoAnterior) return { saltado: false, alertasCreadas: 0 };

  const alertas = compararFotos(seguimiento.tipo, aFotoComparable(fotoAnterior), aFotoComparable(fotoNueva));
  if (alertas.length === 0) return { saltado: false, alertasCreadas: 0 };

  await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx.insert(seguimientoAlertas).values(
      alertas.map((alerta) => ({
        empresaId: seguimiento.empresaId,
        seguimientoId: seguimiento.id,
        fotoId: fotoNueva.id,
        tipo: alerta.tipo,
        detalle: alerta.detalle,
      }))
    )
  );

  return { saltado: false, alertasCreadas: alertas.length };
}

export type ResultadoRevisionInmediata = { ok: true; saltado: boolean; alertasCreadas: number } | { ok: false; error: string };

// Issue #204 — bug real en staging: una fila recién agregada se
// quedaba en guiones hasta que corría el cron, hasta una hora después
// (el workflow corre cada hora, nunca al instante). Mismo
// revisarUnSeguimiento() de siempre (lector + comparación + foto +
// alertas) para UN seguimiento puntual, llamado en el mismo request
// del Server Action de agregar (app/panel/investigacion/seguimiento/actions.ts)
// — nunca dbTrabajadorSeguimiento, que es solo para el lote cross-
// empresa del cron: acá ya se sabe la empresa, el "marcar revisado"
// pasa por dbComoEmpresa()/app_user, igual que el resto del flujo de
// agregar.
//
// Nunca lanza: un error de Mercado Libre en este paso no debe tumbar
// el "seguimiento agregado" que YA se guardó en la base — se informa
// aparte (ver actions.ts) y nunca se marca ultima_revision_ts en ese
// caso, para que el cron de hoy mismo lo reintente solo (al revés del
// fallido del LOTE, que sí se marca para no ahogar los 50 cupos —
// acá no hay ningún lote que ahogar, es un solo seguimiento puntual).
// Si Mercado Libre YA tenía una foto de esta franja hoy para este
// seguimiento (ej. revivir uno eliminado que el cron ya alcanzó a
// procesar en esta misma franja), el índice único + onConflictDoNothing
// de revisarUnSeguimiento lo deja como "saltado", nunca duplicado.
export async function revisarAhoraUnSeguimiento(
  seguimiento: typeof seguimientosMl.$inferSelect,
  ahora: Date = new Date()
): Promise<ResultadoRevisionInmediata> {
  try {
    const resultado = await revisarUnSeguimiento(seguimiento, ahora);
    // Issue #244 — mismo `ahora` que ya decidió la franja y la foto
    // arriba, nunca un `new Date()` aparte (bug real de CI: con un
    // `ahora` de prueba fijo en la mañana, esto marcaba la hora REAL
    // del runner — típicamente ya tarde en Bogotá — y la siguiente
    // consulta de "pendiente en franja tarde" lo daba por ya revisado).
    await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.update(seguimientosMl).set({ ultimaRevisionTs: ahora }).where(eq(seguimientosMl.id, seguimiento.id))
    );
    return { ok: true, saltado: resultado.saltado, alertasCreadas: resultado.alertasCreadas };
  } catch (error) {
    console.error(
      `[lib/trabajos/revisionDiariaSeguimiento] revisión inmediata de ${seguimiento.id} (${seguimiento.tipo}) falló:`,
      error instanceof Error ? error.message : error
    );
    return { ok: false, error: error instanceof Error ? error.message : "No se pudo revisar con Mercado Libre." };
  }
}
