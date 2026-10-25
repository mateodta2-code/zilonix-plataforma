import { and, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { seguimientoAlertas, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { obtenerItemMl, obtenerProducto, obtenerVendedor } from "@/lib/ml/cliente";
import { buscarFotoDeHaceUnMes } from "@/lib/seguimiento/comparativa";
import { esLinkDeTienda, esLinkTiendaOficialSinIdDeVendedor, interpretarEnlaceProducto, interpretarEnlaceTienda } from "@/lib/seguimiento/link";
import { ventasDelPeriodo } from "@/lib/seguimiento/ventas";

// Issue #175 — "máximo 5 competidores por empresa, validado en el
// servidor": literal, acá vive el candado. No es una constraint de
// Postgres (un trigger de conteo agregaría SQL a mano por algo que la
// propia aplicación ya puede chequear antes de insertar, dentro de la
// misma transacción de dbComoEmpresa) — es intencional, pedido así en
// el issue.
export const LIMITE_COMPETIDORES_POR_EMPRESA = 5;

export class LimiteCompetidoresError extends Error {
  constructor() {
    super(`Esta empresa ya tiene ${LIMITE_COMPETIDORES_POR_EMPRESA} competidores marcados — quita uno antes de agregar otro.`);
    this.name = "LimiteCompetidoresError";
  }
}

// Nunca cuenta un seguimiento ya eliminado (eliminado_ts) — quitar un
// competidor libera cupo real, no uno que sigue "gastado" para
// siempre.
export async function contarCompetidoresActivos(empresaId: string): Promise<number> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({ id: seguimientosMl.id })
      .from(seguimientosMl)
      .where(and(eq(seguimientosMl.empresaId, empresaId), eq(seguimientosMl.esCompetidor, true), isNull(seguimientosMl.eliminadoTs)));
    return filas.length;
  });
}

// Se llama ANTES de insertar un seguimiento nuevo marcado como
// competidor (o de marcar uno existente como competidor) — lanza
// LimiteCompetidoresError en vez de dejar pasar un sexto en silencio.
// Nota real: esto no es un candado atómico contra una carrera exacta
// (dos peticiones a la vez podrían las dos leer 4 y las dos insertar)
// — aceptable a propósito para una acción de panel de administración,
// de volumen bajísimo, nunca un endpoint de alto tráfico; si algún día
// hiciera falta un candado real, sería un UPDATE con RETURNING contra
// un contador dedicado, no esto.
export async function verificarCupoCompetidor(empresaId: string): Promise<void> {
  const actuales = await contarCompetidoresActivos(empresaId);
  if (actuales >= LIMITE_COMPETIDORES_POR_EMPRESA) {
    throw new LimiteCompetidoresError();
  }
}

export class SinCuentaMlParaSeguimientoError extends Error {
  constructor() {
    super("Esta empresa todavía no tiene ninguna cuenta de Mercado Libre conectada — hace falta una cuenta propia conectada para poder agregar un seguimiento.");
    this.name = "SinCuentaMlParaSeguimientoError";
  }
}

export class LinkMlInvalidoError extends Error {}

async function tokenPropio(empresaId: string): Promise<string> {
  const cuenta = await obtenerCuentaMlActiva(empresaId);
  if (!cuenta) throw new SinCuentaMlParaSeguimientoError();
  return obtenerAccessTokenVigente(empresaId, cuenta.id);
}

// Issue #201 — bug real en staging: antes, si Mercado Libre no dejaba
// ver el nombre (token vencido ese instante, 403/5xx puntual, etc.),
// el fallback era el id tal cual (`MCO123456789`) — la tabla se
// llenaba de ids indistinguibles entre sí, el cliente no identificaba
// ninguna fila. Ahora el fallback es este placeholder explícito, nunca
// el id: `revisarUnSeguimiento` (lib/trabajos/revisionDiariaSeguimiento.ts)
// reintenta la resolución en cada revisión diaria mientras el nombre
// siga siendo este placeholder — así un fallo transitorio al agregar
// se corrige solo en la próxima corrida, en vez de quedar pegado para
// siempre con el id.
export const NOMBRE_PENDIENTE_PRIMERA_REVISION = "Pendiente de primera revisión";

// Nombre para mostrar en la lista — se intenta al agregar (igual que
// invitaciones.empresa_nombre/rol_nombre) con las funciones YA
// existentes de lib/ml/cliente.ts, nunca una llamada nueva; y se
// reintenta en la primera revisión diaria que encuentre el placeholder
// de arriba (ver revisarUnSeguimiento). Si Mercado Libre no deja ver el
// nombre (enriquecimiento opcional, igual que en investigacion.ts), se
// usa el placeholder en vez de fallar toda la operación — nunca el id.
export async function resolverNombre(tipo: "producto" | "tienda", recursoMl: "item" | "product" | "seller", mlIdExterno: string, token: string): Promise<string> {
  try {
    if (tipo === "tienda") {
      const vendedor = await obtenerVendedor(mlIdExterno, token);
      return vendedor?.nickname ?? NOMBRE_PENDIENTE_PRIMERA_REVISION;
    }
    if (recursoMl === "item") {
      const item = await obtenerItemMl(mlIdExterno, token);
      return item?.producto.nombre ?? NOMBRE_PENDIENTE_PRIMERA_REVISION;
    }
    const producto = await obtenerProducto(mlIdExterno, token);
    return producto?.nombre ?? NOMBRE_PENDIENTE_PRIMERA_REVISION;
  } catch {
    return NOMBRE_PENDIENTE_PRIMERA_REVISION;
  }
}

// Issue #182 — la extensión ("Seguir en Zilonix") puede abrir el mismo
// link más de una vez (clic repetido, F5 sobre la URL con ?agregar=
// antes del redirect, o la pestaña que ya quedó abierta) — antes de
// llamar a agregarSeguimiento() de nuevo (que revive un seguimiento
// eliminado, pero también reescribe nombre/link de uno YA activo sin
// necesidad), se chequea si ya hay uno activo con ese mismo
// ml_id_externo para poder avisar "ya existía" en vez de reinsertar.
export async function buscarSeguimientoActivoPorMlId(empresaId: string, mlIdExterno: string) {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [fila] = await tx
      .select()
      .from(seguimientosMl)
      .where(and(eq(seguimientosMl.empresaId, empresaId), eq(seguimientosMl.mlIdExterno, mlIdExterno), isNull(seguimientosMl.eliminadoTs)));
    return fila ?? null;
  });
}

export type DatosNuevoSeguimiento = { tipo: "producto" | "tienda"; link: string; esCompetidor: boolean };

// Issue #175, punto 5 — "agregar producto, tienda o competidor (máx. 5
// por producto) pegando el enlace o ID de ML". El link se interpreta
// con lib/seguimiento/link.ts (puro texto, nunca Mercado Libre);
// recién después, con el id ya resuelto, se pide el token propio y se
// intenta un nombre lindo para mostrar. Revivir el MISMO ml_id_externo
// que ya estaba eliminado reutiliza esa fila (ver el comentario de
// seguimientos_ml en db/schema.ts) en vez de duplicarla.
export async function agregarSeguimiento(empresaId: string, usuarioId: string, datos: DatosNuevoSeguimiento) {
  let interpretado: { recursoMl: "item" | "product" | "seller"; mlIdExterno: string } | null;
  if (datos.tipo === "tienda") {
    const sellerId = interpretarEnlaceTienda(datos.link);
    interpretado = sellerId ? { recursoMl: "seller", mlIdExterno: sellerId } : null;
  } else {
    interpretado = interpretarEnlaceProducto(datos.link);
  }
  if (!interpretado) {
    // Issue #192 — dos casos puntuales con un mensaje más claro que el
    // genérico de abajo, antes de caer en él:
    if (datos.tipo === "tienda" && esLinkTiendaOficialSinIdDeVendedor(datos.link)) {
      throw new LinkMlInvalidoError(
        "Este link de tienda oficial no trae el id del vendedor; abrí la tienda en ML y usá Seguir en Zilonix, o pegá el seller_id / un link con CustId."
      );
    }
    if (datos.tipo === "producto" && esLinkDeTienda(datos.link)) {
      throw new LinkMlInvalidoError('Ese link es de una tienda, no de un producto — elegí "Tienda" como tipo, o pegá el link de la publicación/catálogo.');
    }
    throw new LinkMlInvalidoError(
      datos.tipo === "tienda"
        ? "No reconocemos ese link o id de tienda — pegá el seller_id numérico, o un link con _CustId_ en la URL."
        : "No reconocemos ese link o id de producto — pegá el link de la publicación/catálogo, o el id MCOxxxx directo."
    );
  }

  if (datos.esCompetidor) await verificarCupoCompetidor(empresaId);

  const token = await tokenPropio(empresaId);
  const nombre = await resolverNombre(datos.tipo, interpretado.recursoMl, interpretado.mlIdExterno, token);

  return dbComoEmpresa(empresaId, async (tx) => {
    const [existente] = await tx
      .select({ id: seguimientosMl.id })
      .from(seguimientosMl)
      .where(and(eq(seguimientosMl.empresaId, empresaId), eq(seguimientosMl.mlIdExterno, interpretado.mlIdExterno)));

    if (existente) {
      const [revivido] = await tx
        .update(seguimientosMl)
        .set({ eliminadoTs: null, esCompetidor: datos.esCompetidor, nombre, linkOriginal: datos.link })
        .where(eq(seguimientosMl.id, existente.id))
        .returning();
      return revivido;
    }

    const [nuevo] = await tx
      .insert(seguimientosMl)
      .values({
        empresaId,
        tipo: datos.tipo,
        recursoMl: interpretado.recursoMl,
        mlIdExterno: interpretado.mlIdExterno,
        nombre,
        linkOriginal: datos.link,
        esCompetidor: datos.esCompetidor,
        creadoPor: usuarioId,
      })
      .returning();
    return nuevo;
  });
}

export async function eliminarSeguimiento(empresaId: string, seguimientoId: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.update(seguimientosMl).set({ eliminadoTs: new Date() }).where(and(eq(seguimientosMl.id, seguimientoId), eq(seguimientosMl.empresaId, empresaId)))
  );
}

export type SeguimientoConUltimaFoto = {
  seguimiento: typeof seguimientosMl.$inferSelect;
  ultimaFoto: typeof seguimientoFotos.$inferSelect | null;
  // Issue #195 — "comparativa": la foto justo antes de la última
  // (para precio/inventario/vendidos "valor + delta", y "ventas hoy")
  // y, si hay historial suficiente, la más cercana a 30 días atrás
  // (para "ventas ~30d") — ver lib/seguimiento/comparativa.ts. null en
  // los dos si no hay (o no hay suficiente) historial — nunca se
  // inventa una comparación con menos datos de los que pide el issue.
  fotoAnterior: typeof seguimientoFotos.$inferSelect | null;
  fotoHaceUnMes: typeof seguimientoFotos.$inferSelect | null;
};

// Lista para /panel/investigacion/seguimiento — precio, inventario,
// vendidos, catálogo y ganador vienen de la ÚLTIMA foto (nunca de un
// cálculo en vivo contra Mercado Libre: esta pantalla lee lo que ya
// guardó la revisión diaria). N+1 a propósito: el volumen esperado por
// empresa es bajo (máx. 5 competidores + algunos productos/tiendas
// propios), nunca cientos de filas que justifiquen una consulta más
// compleja. Issue #195 — ahora trae TODAS las fotos de cada
// seguimiento (no solo la última) para poder armar la comparativa;
// mismo criterio de volumen bajo, una fila por día desde que se agregó.
export async function listarSeguimientosConUltimaFoto(empresaId: string): Promise<SeguimientoConUltimaFoto[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const activos = await tx.select().from(seguimientosMl).where(and(eq(seguimientosMl.empresaId, empresaId), isNull(seguimientosMl.eliminadoTs))).orderBy(desc(seguimientosMl.creadoTs));

    const resultado: SeguimientoConUltimaFoto[] = [];
    for (const seguimiento of activos) {
      const fotos = await tx
        .select()
        .from(seguimientoFotos)
        .where(eq(seguimientoFotos.seguimientoId, seguimiento.id))
        .orderBy(desc(seguimientoFotos.fecha));
      const ultimaFoto = fotos[0] ?? null;
      const fotoAnterior = fotos[1] ?? null;
      const fotoHaceUnMes = ultimaFoto ? buscarFotoDeHaceUnMes(fotos.slice(1), ultimaFoto.fecha) : null;
      resultado.push({ seguimiento, ultimaFoto, fotoAnterior, fotoHaceUnMes });
    }
    return resultado;
  });
}

export type SeguimientoConFotosParaVentas = {
  seguimiento: typeof seguimientosMl.$inferSelect;
  ultimaFoto: typeof seguimientoFotos.$inferSelect | null;
  // 2ª foto más reciente — "ayer" en la práctica, salvo que el trabajo
  // diario se haya saltado algún día (seguimiento recién agregado,
  // falla puntual de Mercado Libre, etc.): nunca se asume "ayer
  // calendario", se toma la fila real que sigue a la última.
  fotoAnterior: typeof seguimientoFotos.$inferSelect | null;
  // Issue #196 — "~30 días": la foto más CERCANA a hace 30 días,
  // dentro de una ventana de 25-35 (una revisión diaria puede faltar
  // algún día puntual — nunca se exige el día 30 exacto). null si
  // ningún día de esa ventana tiene foto (seguimiento con menos de ~25
  // días de antigüedad, por ejemplo) — nunca se aproxima con la más
  // vieja o la más nueva disponible, eso sería inventar el período.
  fotoCerca30d: typeof seguimientoFotos.$inferSelect | null;
};

// Días desde hoy (medianoche UTC) hacia atrás — mismo criterio de
// "solo la FECHA" que fechaDeHoy() en lib/trabajos/revisionDiariaSeguimiento.ts.
function diasAtras(desde: Date, dias: number): Date {
  const d = new Date(desde);
  d.setUTCDate(d.getUTCDate() - dias);
  return d;
}

// La de menor distancia absoluta al objetivo — con como mucho ~11
// fotos candidatas (una por día, ventana de 11 días), un reduce() en
// memoria alcanza de sobra, sin necesitar ORDER BY ABS(...) en SQL.
function fotoMasCercaDe(fotos: (typeof seguimientoFotos.$inferSelect)[], objetivo: Date): typeof seguimientoFotos.$inferSelect | null {
  if (fotos.length === 0) return null;
  return fotos.reduce((mejor, actual) =>
    Math.abs(actual.fecha.getTime() - objetivo.getTime()) < Math.abs(mejor.fecha.getTime() - objetivo.getTime()) ? actual : mejor
  );
}

// Issue #196 (apoya #195/#175) — capa de datos para las tarjetas
// "Hoy"/"~30 días" del panel: por cada seguimiento activo, las dos
// fotos más recientes (para ventasDelPeriodo() de "hoy") y la foto más
// cercana a hace 30 días (para ventasDelPeriodo() de "~30 días").
// Mismo criterio de volumen que listarSeguimientosConUltimaFoto (N+1 a
// propósito, nunca cientos de seguimientos por empresa).
export async function listarSeguimientosConFotosParaVentas(empresaId: string): Promise<SeguimientoConFotosParaVentas[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const activos = await tx.select().from(seguimientosMl).where(and(eq(seguimientosMl.empresaId, empresaId), isNull(seguimientosMl.eliminadoTs))).orderBy(desc(seguimientosMl.creadoTs));

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const objetivo30d = diasAtras(hoy, 30);
    const desdeVentana30d = diasAtras(hoy, 35);
    const hastaVentana30d = diasAtras(hoy, 25);

    const resultado: SeguimientoConFotosParaVentas[] = [];
    for (const seguimiento of activos) {
      const recientes = await tx
        .select()
        .from(seguimientoFotos)
        .where(eq(seguimientoFotos.seguimientoId, seguimiento.id))
        .orderBy(desc(seguimientoFotos.fecha))
        .limit(2);

      const candidatas30d = await tx
        .select()
        .from(seguimientoFotos)
        .where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), gte(seguimientoFotos.fecha, desdeVentana30d), lte(seguimientoFotos.fecha, hastaVentana30d)));

      resultado.push({
        seguimiento,
        ultimaFoto: recientes[0] ?? null,
        fotoAnterior: recientes[1] ?? null,
        fotoCerca30d: fotoMasCercaDe(candidatas30d, objetivo30d),
      });
    }
    return resultado;
  });
}

// Issue #222 — "estimado → medido": ventana de ~7 días (5-9, mismo
// margen relativo que la de 30 días de arriba) para considerar que un
// seguimiento ya tiene suficiente historial real como para medir en
// vez de estimar. Nunca se exige el día 7 exacto ni se aproxima con la
// foto más vieja/nueva disponible fuera de la ventana — si no hay
// ninguna foto real ahí, todavía no hay medición, se sigue mostrando
// el estimado (ver elegirVentasMes, lib/seguimiento/ventas.ts).
const DIAS_VENTANA_MEDICION = 7;
const MARGEN_VENTANA_MEDICION = 2;

// Issue #222 — el puente real entre Seguimiento e Investigación: `mlIdExterno`
// es el mismo `itemId` que ya usa Investigación (lib/ml/investigacion.ts)
// para cada publicación. Si ese id no está en seguimiento activo, o
// está pero todavía no tiene una foto real a ~7 días de la última, no
// hay medición posible todavía — null, nunca un número inventado ni
// una ventana más corta "para no dejarlo en null". Quien llame a esto
// decide qué mostrar (ver elegirVentasMes) — acá solo se resuelve el
// dato real si existe.
export async function buscarMedicionSiExiste(empresaId: string, mlIdExterno: string): Promise<number | null> {
  const seguimiento = await buscarSeguimientoActivoPorMlId(empresaId, mlIdExterno);
  if (!seguimiento) return null;

  return dbComoEmpresa(empresaId, async (tx) => {
    const [ultimaFoto] = await tx
      .select()
      .from(seguimientoFotos)
      .where(eq(seguimientoFotos.seguimientoId, seguimiento.id))
      .orderBy(desc(seguimientoFotos.fecha))
      .limit(1);
    if (!ultimaFoto) return null;

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    const objetivo7d = diasAtras(hoy, DIAS_VENTANA_MEDICION);
    const desdeVentana7d = diasAtras(hoy, DIAS_VENTANA_MEDICION + MARGEN_VENTANA_MEDICION);
    const hastaVentana7d = diasAtras(hoy, DIAS_VENTANA_MEDICION - MARGEN_VENTANA_MEDICION);

    const candidatas7d = await tx
      .select()
      .from(seguimientoFotos)
      .where(and(eq(seguimientoFotos.seguimientoId, seguimiento.id), gte(seguimientoFotos.fecha, desdeVentana7d), lte(seguimientoFotos.fecha, hastaVentana7d)));

    // Nunca la misma foto de los dos lados de la resta — necesita DOS
    // fotos reales distintas separadas ~7 días, igual que ventasDelPeriodo
    // ya exige para "hoy"/"~30 días".
    const foto7d = fotoMasCercaDe(candidatas7d.filter((f) => f.id !== ultimaFoto.id), objetivo7d);
    if (!foto7d) return null;

    return ventasDelPeriodo(ultimaFoto.vendidos, foto7d.vendidos);
  });
}

export type DetalleSeguimiento = {
  seguimiento: typeof seguimientosMl.$inferSelect;
  fotos: (typeof seguimientoFotos.$inferSelect)[];
  alertas: (typeof seguimientoAlertas.$inferSelect)[];
};

// Detalle con historial completo — la gráfica de precio/ventas por día
// (punto 5) se arma en la página directo a partir de `fotos`, en el
// orden que ya vienen (más viejo primero).
export async function obtenerDetalleSeguimiento(empresaId: string, seguimientoId: string): Promise<DetalleSeguimiento | null> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const [seguimiento] = await tx.select().from(seguimientosMl).where(and(eq(seguimientosMl.id, seguimientoId), eq(seguimientosMl.empresaId, empresaId)));
    if (!seguimiento) return null;

    const fotos = await tx.select().from(seguimientoFotos).where(eq(seguimientoFotos.seguimientoId, seguimientoId)).orderBy(seguimientoFotos.fecha);
    const alertas = await tx.select().from(seguimientoAlertas).where(eq(seguimientoAlertas.seguimientoId, seguimientoId)).orderBy(desc(seguimientoAlertas.creadoTs));
    return { seguimiento, fotos, alertas };
  });
}

export type AlertaDelDia = { alerta: typeof seguimientoAlertas.$inferSelect; nombreSeguimiento: string };

// "Alertas del día" (arriba de la pantalla, punto 5) — por fecha de
// creación de la alerta, nunca por fecha de la foto (una alerta
// siempre se crea el mismo día que corre la revisión, son la misma
// fecha en la práctica, pero comparar por creado_ts es más directo).
export async function listarAlertasDelDia(empresaId: string): Promise<AlertaDelDia[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({ alerta: seguimientoAlertas, nombreSeguimiento: seguimientosMl.nombre })
      .from(seguimientoAlertas)
      .innerJoin(seguimientosMl, eq(seguimientoAlertas.seguimientoId, seguimientosMl.id))
      .where(eq(seguimientoAlertas.empresaId, empresaId))
      .orderBy(desc(seguimientoAlertas.creadoTs));

    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);
    return filas.filter((f) => f.alerta.creadoTs >= hoy);
  });
}

export async function marcarAlertaLeida(empresaId: string, alertaId: string): Promise<void> {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.update(seguimientoAlertas).set({ leidaTs: new Date() }).where(and(eq(seguimientoAlertas.id, alertaId), eq(seguimientoAlertas.empresaId, empresaId)))
  );
}
