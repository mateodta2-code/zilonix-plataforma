import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { dbTrabajadorSeguimiento } from "@/db/trabajador-seguimiento-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, seguimientoAlertas, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { fechaDiaBogota, rangoDiaBogota } from "@/lib/filtros-listado";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import {
  confirmarRecursoProductoMl,
  LimiteMercadoLibreError,
  MlNoAutorizadoError,
  MlNoDisponibleError,
  MlRespuestaInesperadaError,
  MlSinPermisoAppError,
} from "@/lib/ml/cliente";
import { leerFotoSeguimiento, type SeguimientoParaLeer } from "@/lib/seguimiento/lector";
import { compararFotos, normalizarPublicaciones, type FotoComparable } from "@/lib/seguimiento/alertas";
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

// Issue #250, punto C — "agregar recurso_ml, ml_id_externo y status
// HTTP al log (nunca el token)": el status real no viene siempre como
// un número suelto (ver lib/ml/cliente.ts) — cada tipo de error ya
// confirmado ahí implica un código fijo, salvo MlRespuestaInesperadaError
// (trae el suyo) y MlNoDisponibleError (5xx O tiempo agotado, sin un
// único código real que mostrar). Nunca lee nada del error que no sea
// uno de estos tipos ya confirmados — nunca imprime el texto crudo de
// una respuesta de Mercado Libre, que podría traer datos de la cuenta.
function detalleErrorMlParaLog(error: unknown): { status: number | null; endpoint: string | null } {
  if (error instanceof MlRespuestaInesperadaError) return { status: error.status, endpoint: null };
  if (error instanceof MlSinPermisoAppError) return { status: 403, endpoint: error.endpoint };
  if (error instanceof MlNoAutorizadoError) return { status: 401, endpoint: null };
  if (error instanceof LimiteMercadoLibreError) return { status: 429, endpoint: null };
  if (error instanceof MlNoDisponibleError) return { status: null, endpoint: null }; // 5xx o tiempo agotado, sin un código único
  return { status: null, endpoint: null };
}

export type ResultadoRevisionDiaria = {
  activos: number;
  procesados: number;
  // Issue #196 — distinto de "procesados": el índice único
  // seguimiento_id+fecha bloqueó el insert en la carrera real
  // (rarísima) de dos corridas del cron a la vez — nunca se escribió
  // nada nuevo, pero tampoco fue un error real (ver revisarUnSeguimiento).
  // Corrección de Pablo al punto 3 del #250 — el caso COMÚN de "ya
  // había foto de hoy" (la ronda de la tarde alcanzando lo que la
  // madrugada ya procesó, o la lectura de la extensión del #251 que ya
  // creó la fila con solo sus propios campos) ya NO cuenta como
  // saltado: se detecta antes de llamar a ML y se actualiza/completa
  // esa fila, así que cuenta como "procesados".
  saltados: number;
  fallidos: number;
  alertasCreadas: number;
};

// Issue #251 (revisión de Pablo) — "mismo día" es medianoche de
// BOGOTÁ, no de UTC: una persona que lee una ficha a las 8pm en
// Colombia ya está en el día siguiente en UTC (19:00 Bogotá = 00:00
// UTC) — con el criterio viejo, esa lectura se guardaba en la fecha de
// MAÑANA desde la perspectiva de Bogotá. Más importante todavía: esta
// es la misma cuenta que usa guardarDatoDePaginaSeguimiento
// (lib/seguimiento/seguimientos.ts) para decidir la fila de HOY — si
// las dos no coincidieran dígito a dígito, la revisión por API y la
// lectura de la página nunca compartirían la misma fila (issue #251,
// punto 11), por más que las dos pasaran el mismo día real.
// `fechaDiaBogota` (lib/filtros-listado.ts) ya resuelve esta cuenta en
// un solo lugar — nunca una cuenta de huso horario propia acá.
// Corrección de Pablo — esto usaba `rangoDiaBogota(ahora).inicio`
// (05:00 UTC, el instante real de la medianoche de Bogotá), pero
// `seguimiento_fotos.fecha` es un marcador de día calendario que
// siempre se guardó como medianoche UTC (00:00Z) — con 05:00Z, las
// filas nuevas no coincidían con las viejas ni con lo que guarda
// guardarDatoDePaginaSeguimiento (lib/seguimiento/seguimientos.ts),
// rompiendo la fila compartida entre API y extensión (issue #251,
// punto 11). `fechaDiaBogota` resuelve el mismo día calendario de
// Bogotá, pero representado como 00:00Z — compatible con las filas
// existentes. Issue #250, punto E — ninguna de las dos ventanas del
// cron (madrugada/tarde, ver
// .github/workflows/revision-diaria-seguimiento.yml) cruza la
// medianoche de Bogotá, así que esta fecha sigue cayendo siempre en el
// mismo día calendario para las dos ventanas.
function fechaDeHoy(): Date {
  return fechaDiaBogota(new Date());
}

// Issue #250, punto E (decisión de Mateo, 2026-10-25) — dos ventanas
// de revisión automática al día (madrugada 08:00-13:00 UTC, tarde
// 20:00-23:00 UTC — ver .github/workflows/revision-diaria-seguimiento.yml).
// Antes de esto, el filtro de abajo comparaba contra la fecha
// calendario ("ya revisado HOY") — con dos ventanas en el mismo día
// calendario, la ronda de la tarde nunca volvía a tomar un
// seguimiento que la madrugada ya había marcado con
// `ultima_revision_ts` esa misma mañana: las dos rondas colapsaban en
// una sola. Se compara contra "hace menos de N horas" en vez de "hoy".
//
// N = 6 horas, elegido a partir de las ventanas reales: el hueco más
// corto entre el FIN de una ventana y el INICIO de la siguiente es de
// 7 horas (13:00 UTC -> 20:00 UTC, madrugada a tarde). 6 horas deja un
// margen real de al menos 1 hora antes de que la ventana siguiente
// empiece a correr — un seguimiento revisado en el último minuto de
// una ventana ya queda elegible desde el primer minuto de la próxima,
// con margen de sobra para los reintentos horarios dentro de cada
// ventana.
const VENTANA_MINIMA_ENTRE_REVISIONES_HORAS = 6;

function limiteRevisionReciente(): Date {
  const limite = new Date();
  limite.setUTCHours(limite.getUTCHours() - VENTANA_MINIMA_ENTRE_REVISIONES_HORAS);
  return limite;
}

// Issue real: el lote tomaba siempre los mismos 50 sin ningún orden —
// un seguimiento 51 nunca llegaba a revisarse si la empresa tenía más
// de un lote. Dos correcciones, exportada aparte para poder probar el
// orden y el filtro solos:
// - Filtro: nunca un seguimiento ya eliminado, y solo los que NO se
//   revisaron en las últimas VENTANA_MINIMA_ENTRE_REVISIONES_HORAS
//   horas (o nunca) — issue #250, punto E: antes era "hoy" (fecha
//   calendario), lo que bloqueaba la segunda ronda del mismo día.
// - Orden: ASC NULLS FIRST por ultima_revision_ts — el que nunca se
//   revisó, o el que hace más tiempo que no se revisa, entra primero
//   al lote. Así, entre varias corridas de la misma ventana, el lote
//   siguiente SÍ llega a los que quedaron afuera del anterior, nunca
//   repite los mismos primeros 50 una y otra vez.
export async function obtenerSeguimientosPendientesDeHoy(): Promise<(typeof seguimientosMl.$inferSelect)[]> {
  const limite = limiteRevisionReciente();
  return dbTrabajadorSeguimiento
    .select()
    .from(seguimientosMl)
    .where(and(isNull(seguimientosMl.eliminadoTs), or(isNull(seguimientosMl.ultimaRevisionTs), lt(seguimientosMl.ultimaRevisionTs, limite))))
    .orderBy(sql`${seguimientosMl.ultimaRevisionTs} ASC NULLS FIRST`)
    .limit(TAMAÑO_LOTE);
}

export async function revisarSeguimientosDelDia(): Promise<ResultadoRevisionDiaria> {
  const activos = await obtenerSeguimientosPendientesDeHoy();

  let procesados = 0;
  let saltados = 0;
  let fallidos = 0;
  let alertasCreadas = 0;

  for (let i = 0; i < activos.length; i++) {
    if (i > 0) await esperar(PAUSA_ENTRE_SEGUIMIENTOS_MS);
    const seguimiento = activos[i];
    try {
      const resultado = await revisarUnSeguimiento(seguimiento);
      if (resultado.saltado) saltados += 1;
      else procesados += 1;
      alertasCreadas += resultado.alertasCreadas;
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id));
    } catch (error) {
      // Un seguimiento que falla (cuenta sin token vigente, Mercado
      // Libre caído, etc.) no debe tumbar el lote entero — mismo
      // criterio que procesarAvisosPendientes (lib/ml/trabajador.ts).
      fallidos += 1;
      const { status, endpoint } = detalleErrorMlParaLog(error);
      console.error(
        `Seguimiento ${seguimiento.id} (${seguimiento.tipo}, recurso_ml=${seguimiento.recursoMl}, ml_id_externo=${seguimiento.mlIdExterno}` +
          `${status != null ? `, HTTP ${status}` : ""}${endpoint ? `, endpoint=${endpoint}` : ""}) no se pudo revisar:`,
        error instanceof Error ? error.message : error
      );
      // Issue #175 (reafirmado tras la corrección de Pablo al punto C
      // del #250) — SÍ se marca ultima_revision_ts también en un
      // fallo: sin esto, un fallido permanente (empresa sin cuenta ML
      // conectada, recurso que de verdad no existe) se queda al frente
      // del lote (ASC NULLS FIRST) para siempre, ahogando los 50 cupos
      // en cada corrida siguiente — el bug real que #175 corrigió.
      // Con el filtro de VENTANA_MINIMA_ENTRE_REVISIONES_HORAS (6h,
      // punto E) esto YA significa "reintentar en la próxima ventana"
      // (dos veces al día), nunca "esperar hasta mañana" como antes de
      // ese punto — por eso una primera versión de este punto C había
      // quitado esta línea pensando que hacía falta para reintentar
      // más seguido; Pablo corrigió que eso rompía la protección real
      // de #175 sin necesidad, porque la ventana de 6h ya resuelve el
      // reintento rápido por sí sola.
      await dbTrabajadorSeguimiento.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id));
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
    // Issue #251 (corrección de Pablo, punto 3) — una fila guardada
    // antes de que existiera `total`/`fuente` puede traer el array
    // viejo directo; normalizarPublicaciones la envuelve antes de que
    // compararFotos (lib/seguimiento/alertas.ts) la use, nunca revienta
    // en `.visibles.map(...)`.
    publicaciones: normalizarPublicaciones(fila.publicaciones),
  };
}

type ResultadoUnSeguimiento = { saltado: boolean; alertasCreadas: number };

// Campos que SIEMPRE vienen de la API (nunca los escribe la
// extensión) — los únicos que la ronda de la tarde actualiza cuando
// ya existe una foto de hoy (ver más abajo). inventarioDisponible/
// inventarioAproximado/vendidos/publicaciones quedan afuera a
// propósito: son las mismas columnas que issue #251 reusa para lo que
// la extensión lee de la página (nunca llamadas a Mercado Libre) —
// esta ronda nunca debe pisar un dato más completo (de la extensión)
// con uno más parcial de la API, mismo criterio documentado en
// guardarDatoDePaginaSeguimiento (lib/seguimiento/seguimientos.ts),
// que hace lo simétrico: nunca toca estos campos de acá.
type CamposApiDeFoto = Pick<typeof seguimientoFotos.$inferInsert, "precio" | "precioAnterior" | "estado" | "enCatalogo" | "ganaBotonCompra" | "esFull" | "esEnvioGratis">;

function camposApiDeDatos(datos: Awaited<ReturnType<typeof leerConReintento429>>): CamposApiDeFoto {
  return {
    precio: datos.precio != null ? String(datos.precio) : null,
    precioAnterior: datos.precioAnterior != null ? String(datos.precioAnterior) : null,
    estado: datos.estado,
    enCatalogo: datos.enCatalogo,
    ganaBotonCompra: datos.ganaBotonCompra,
    esFull: datos.esFull,
    esEnvioGratis: datos.esEnvioGratis,
  };
}

// `saltado: true` SOLO en la carrera real (rarísima) de dos corridas
// del cron a la vez: la ronda de la tarde (abajo) ya mira si hay foto
// de hoy ANTES de llamar a Mercado Libre, así que el índice único
// seguimiento_id+fecha solo llega a bloquear un insert cuando otra
// corrida lo insertó en el instante exacto entre ese chequeo y este
// insert — onConflictDoNothing sigue de red de seguridad para ESE
// caso, nunca para el camino normal de la tarde (que ahora actualiza,
// no inserta-y-descarta). `saltado: false` con `alertasCreadas: 0` es
// un caso DISTINTO: la foto de hoy SÍ se escribió/actualizó (sí fue
// "procesado"), simplemente no hay foto de ayer con qué compararla
// todavía (primera foto de este seguimiento) — no hay alertas que
// generar, pero no es un salto.
async function revisarUnSeguimiento(seguimiento: typeof seguimientosMl.$inferSelect): Promise<ResultadoUnSeguimiento> {
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
  //
  // Issue #252 (smoke de staging) — bug real confirmado: MCO452014269
  // se quedó en el placeholder para SIEMPRE porque `recurso_ml` se
  // guardó mal ANTES de que agregarSeguimiento confirmara el tipo
  // contra ML (issue #250, punto A) — `/items/{id}` 404 para siempre
  // con un id que en realidad es de catálogo, así que `resolverNombre`
  // (abajo) nunca podía resolver nada, sin importar cuántas veces
  // corriera el cron (ni "Revisar ahora", que comparte esta misma
  // función). Mientras el nombre siga en el placeholder, se vuelve a
  // confirmar el tipo real con `confirmarRecursoProductoMl` (el mismo
  // chequeo que ya usa el alta nueva y
  // scripts/corregir-tipo-recurso-seguimiento.ts, sin token) — si
  // Mercado Libre confirma un tipo DISTINTO al guardado, se corrige en
  // la base ANTES de intentar el nombre, y el resto de esta función
  // (la lectura de la foto del día, más abajo) usa el tipo corregido,
  // nunca el viejo.
  let recursoMl = seguimiento.recursoMl;
  if (seguimiento.nombre === NOMBRE_PENDIENTE_PRIMERA_REVISION) {
    if (seguimiento.tipo === "producto") {
      const confirmacion = await confirmarRecursoProductoMl(seguimiento.mlIdExterno);
      if (confirmacion.estado === "confirmado" && confirmacion.recursoMl !== recursoMl) {
        recursoMl = confirmacion.recursoMl;
        await dbComoEmpresa(seguimiento.empresaId, (tx) => tx.update(seguimientosMl).set({ recursoMl }).where(eq(seguimientosMl.id, seguimiento.id)));
      }
    }
    const nombreResuelto = await resolverNombre(seguimiento.tipo, recursoMl, seguimiento.mlIdExterno, token);
    if (nombreResuelto !== NOMBRE_PENDIENTE_PRIMERA_REVISION) {
      await dbComoEmpresa(seguimiento.empresaId, (tx) => tx.update(seguimientosMl).set({ nombre: nombreResuelto }).where(eq(seguimientosMl.id, seguimiento.id)));
    }
  }

  const hoy = fechaDeHoy();

  // Corrección de Pablo (revisión del PR #253), punto 3 — mirar ANTES
  // de llamar a Mercado Libre si ya hay foto de hoy (hora Bogotá;
  // fechaDeHoy() ya resuelve el mismo día calendario en Bogotá para
  // las dos ventanas del cron, punto E — ninguna cruza medianoche
  // Bogotá, y es la misma cuenta que usa guardarDatoDePaginaSeguimiento
  // del #251). La ronda de la tarde alcanzando un seguimiento que la
  // madrugada ya procesó hoy mismo es el caso NORMAL, no una carrera —
  // antes esto llamaba a Mercado Libre igual y descartaba el resultado
  // con onConflictDoNothing ("saltado"), gastando la llamada para
  // nada. Ahora se sabe desde acá si toca ACTUALIZAR la fila de hoy en
  // vez de intentar insertar una nueva — y esa fila puede existir
  // también porque la extensión (#251) ya la creó hoy con solo sus
  // propios campos (API en null): eso tampoco debe tratarse como "ya
  // revisado por la API", así que nunca se gatea por `precio != null`
  // acá, solo por la EXISTENCIA de la fila.
  const [fotoDeHoyExistente] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx.select().from(seguimientoFotos).where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), eq(seguimientoFotos.fecha, hoy)))
  );

  // Issue #252 (smoke de staging) — `{ ...seguimiento, recursoMl }`,
  // nunca `seguimiento` tal cual: si el bloque de arriba corrigió el
  // tipo real, esta lectura (y todo lo que dependa de ella) tiene que
  // usar el tipo YA corregido, nunca el que seguía guardado mal.
  const datos = await leerConReintento429({ ...seguimiento, recursoMl }, token, cuentaFila.cuentaIdExterna);

  const [fotoAnterior] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx
      .select()
      .from(seguimientoFotos)
      .where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), lt(seguimientoFotos.fecha, hoy)))
      .orderBy(desc(seguimientoFotos.fecha))
      .limit(1)
  );

  let fotoNueva: typeof seguimientoFotos.$inferSelect | undefined;
  if (fotoDeHoyExistente) {
    // Actualiza SOLO los campos de API (precio, Full, catálogo, etc.)
    // con lo más reciente — nunca toca inventarioDisponible/
    // inventarioAproximado/vendidos/publicaciones (ver camposApiDeDatos,
    // arriba: son los mismos campos que issue #251 reusa para la
    // lectura de la extensión). Genera alertas comparando esta fila ya
    // actualizada contra la de ayer, igual que el camino de insertar.
    [fotoNueva] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.update(seguimientoFotos).set(camposApiDeDatos(datos)).where(eq(seguimientoFotos.id, fotoDeHoyExistente.id)).returning()
    );
  } else {
    [fotoNueva] = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx
        .insert(seguimientoFotos)
        .values({
          empresaId: seguimiento.empresaId,
          seguimientoId: seguimiento.id,
          fecha: hoy,
          ...camposApiDeDatos(datos),
          inventarioDisponible: datos.inventarioDisponible,
          inventarioAproximado: datos.inventarioAproximado,
          vendidos: datos.vendidos,
          // Issue #251, punto 5 — el total REAL ("752 resultados") solo
          // lo puede traer la lectura de página (la API da 403 real al
          // listar publicaciones de una tienda ajena); acá solo se
          // insertó lo que la API pudo ver, nunca un total inventado.
          publicaciones: datos.publicaciones != null ? { total: null, visibles: datos.publicaciones, fuente: "api" } : null,
        })
        // Corrección de Pablo — onConflictDoUpdate en vez de
        // onConflictDoNothing: en la carrera real (rarísima) de dos
        // corridas a la vez, o del cron chocando con la extensión
        // (#251) insertando casi al mismo tiempo, descartar el
        // resultado tiraría los datos de la API que SÍ se acaban de
        // leer. Actualiza solo los campos de API (mismo
        // camposApiDeDatos de la rama "ya existe foto" de arriba)
        // sobre lo que sea que ganó la carrera — nunca pisa
        // inventarioDisponible/vendidos/publicaciones.
        .onConflictDoUpdate({ target: [seguimientoFotos.seguimientoId, seguimientoFotos.fecha], set: camposApiDeDatos(datos) })
        .returning()
    );
  }
  if (!fotoNueva) return { saltado: true, alertasCreadas: 0 };
  if (!fotoAnterior) return { saltado: false, alertasCreadas: 0 };

  const alertas = compararFotos(seguimiento.tipo, aFotoComparable(fotoAnterior), aFotoComparable(fotoNueva));
  if (alertas.length === 0) return { saltado: false, alertasCreadas: 0 };

  // Punto 2 de la revisión de Pablo — la ronda de la tarde (o "Revisar
  // ahora") puede volver a comparar la foto de hoy YA actualizada
  // contra la misma foto de ayer y encontrar la MISMA alerta otra vez
  // (ej. el mismo precio_bajo). Nunca se inserta una alerta del mismo
  // tipo para el mismo seguimiento si ya existe una de hoy (hora
  // Bogotá) — sin índice único nuevo (sin migración): se filtra en la
  // aplicación, mismo criterio ya aceptado para volumen bajo que
  // verificarCupoCompetidor (lib/seguimiento/seguimientos.ts) — no es
  // un candado atómico contra una carrera exacta, pero el volumen real
  // de alertas por seguimiento por día es bajísimo. `seguimiento_alertas.creado_ts`
  // es un instante real (timestamptz, a diferencia de `fecha`, que es
  // un DATE) — reusa el mismo `rangoDiaBogota` de arriba en vez de una
  // segunda cuenta de huso horario propia.
  const { inicio: inicioHoyBogota, finExclusivo: finHoyBogota } = rangoDiaBogota(new Date());
  const alertasDeHoy = await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx
      .select({ tipo: seguimientoAlertas.tipo })
      .from(seguimientoAlertas)
      .where(
        and(
          eq(seguimientoAlertas.seguimientoId, seguimiento.id),
          gte(seguimientoAlertas.creadoTs, inicioHoyBogota),
          lt(seguimientoAlertas.creadoTs, finHoyBogota)
        )
      )
  );
  const tiposYaHoy = new Set(alertasDeHoy.map((a) => a.tipo));
  const alertasNuevas = alertas.filter((alerta) => !tiposYaHoy.has(alerta.tipo));
  if (alertasNuevas.length === 0) return { saltado: false, alertasCreadas: 0 };

  await dbComoEmpresa(seguimiento.empresaId, (tx) =>
    tx.insert(seguimientoAlertas).values(
      alertasNuevas.map((alerta) => ({
        empresaId: seguimiento.empresaId,
        seguimientoId: seguimiento.id,
        fotoId: fotoNueva.id,
        tipo: alerta.tipo,
        detalle: alerta.detalle,
      }))
    )
  );

  return { saltado: false, alertasCreadas: alertasNuevas.length };
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
// Si ya hay foto de hoy para este seguimiento (ej. el cron ya lo
// procesó hoy mismo), revisarUnSeguimiento ACTUALIZA esa fila con lo
// más reciente de la API en vez de insertar una nueva — nunca
// duplicada, y "saltado" queda solo para la carrera real (rarísima)
// que describe el comentario de revisarUnSeguimiento.
export async function revisarAhoraUnSeguimiento(seguimiento: typeof seguimientosMl.$inferSelect): Promise<ResultadoRevisionInmediata> {
  try {
    const resultado = await revisarUnSeguimiento(seguimiento);
    await dbComoEmpresa(seguimiento.empresaId, (tx) =>
      tx.update(seguimientosMl).set({ ultimaRevisionTs: new Date() }).where(eq(seguimientosMl.id, seguimiento.id))
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
