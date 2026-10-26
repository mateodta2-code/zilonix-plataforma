import { and, desc, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { seguimientoAlertas, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { fechaDiaBogota } from "@/lib/filtros-listado";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { confirmarRecursoProductoMl, obtenerItemMl, obtenerProducto, obtenerVendedor } from "@/lib/ml/cliente";
import { buscarFotoDeHaceUnMes } from "@/lib/seguimiento/comparativa";
import { esLinkDeTienda, esLinkTiendaOficialSinIdDeVendedor, interpretarEnlaceProducto, interpretarEnlaceTienda } from "@/lib/seguimiento/link";
import { ventasDelPeriodo } from "@/lib/seguimiento/ventas";

// Issue #251 — "tope de 5 tiendas y 5 productos de competencia por
// comercio, validado en el servidor": DOS pozos separados, no uno
// combinado — antes de este issue, `LIMITE_COMPETIDORES_POR_EMPRESA`
// (5) era un único pozo mezclando tienda+producto; el issue pide
// explícitamente "5 tiendas Y 5 productos" (hasta 10 en total). No es
// una constraint de Postgres (un trigger de conteo agregaría SQL a
// mano por algo que la propia aplicación ya puede chequear antes de
// insertar, dentro de la misma transacción de dbComoEmpresa) —
// intencional, pedido así en el issue original (#175).
export const LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA = 5;
export const LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA = 5;

export class LimiteCompetidoresError extends Error {
  constructor(tipo: "producto" | "tienda") {
    const limite = tipo === "tienda" ? LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA : LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA;
    const sustantivo = tipo === "tienda" ? "tiendas" : "productos";
    super(`Esta empresa ya tiene ${limite} ${sustantivo} de competencia marcados — quita uno antes de agregar otro.`);
    this.name = "LimiteCompetidoresError";
  }
}

// Nunca cuenta un seguimiento ya eliminado (eliminado_ts) — quitar un
// competidor libera cupo real, no uno que sigue "gastado" para
// siempre. Issue #251 — ahora cuenta POR TIPO, nunca los dos juntos
// (ver el comentario de los límites, arriba).
export async function contarCompetidoresActivos(empresaId: string, tipo: "producto" | "tienda"): Promise<number> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .select({ id: seguimientosMl.id })
      .from(seguimientosMl)
      .where(
        and(eq(seguimientosMl.empresaId, empresaId), eq(seguimientosMl.tipo, tipo), eq(seguimientosMl.esCompetidor, true), isNull(seguimientosMl.eliminadoTs))
      );
    return filas.length;
  });
}

// Se llama ANTES de insertar un seguimiento nuevo marcado como
// competidor (o de marcar uno existente como competidor) — lanza
// LimiteCompetidoresError en vez de dejar pasar un sexto DEL MISMO
// TIPO en silencio (el sexto producto se rechaza aunque haya cupo de
// tiendas, y viceversa). Nota real: esto no es un candado atómico
// contra una carrera exacta (dos peticiones a la vez podrían las dos
// leer 4 y las dos insertar) — aceptable a propósito para una acción
// de panel de administración, de volumen bajísimo, nunca un endpoint
// de alto tráfico; si algún día hiciera falta un candado real, sería
// un UPDATE con RETURNING contra un contador dedicado, no esto.
export async function verificarCupoCompetidor(empresaId: string, tipo: "producto" | "tienda"): Promise<void> {
  const actuales = await contarCompetidoresActivos(empresaId, tipo);
  const limite = tipo === "tienda" ? LIMITE_TIENDAS_COMPETIDOR_POR_EMPRESA : LIMITE_PRODUCTOS_COMPETIDOR_POR_EMPRESA;
  if (actuales >= limite) {
    throw new LimiteCompetidoresError(tipo);
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

// Issue #251 — Mercado Libre no deja ver, por la API, el inventario
// (available_quantity) ni los vendidos (sold_quantity) reales de un
// ITEM ajeno de forma confiable (null/ausente, confirmado en #250), y
// da 403 real al listar publicaciones de una TIENDA ajena — la
// extensión lee estos datos de la página que la persona ya tiene
// abierta en pantalla (ficha del competidor, o listado de la tienda
// seguida) y los manda por el mismo puente que ya usa "Completar
// vendidos" (extension/content.js -> background.js ->
// marcador-zilonix.js -> esta Server Action).
export type DatoPaginaSeguimiento =
  | {
      tipoSeguimiento: "producto";
      mlIdExterno: string;
      inventario: number | null;
      inventarioAproximado: boolean;
      vendidos: number | null;
      // Issue #251 (corrección de Pablo, punto 5) — "+N vendidos" (el
      // piso redondeado de la ficha) nunca es el mismo dato que
      // sold_quantity real: false cuando `vendidos` es solo esa
      // etiqueta aproximada — guardarDatoDePaginaSeguimiento nunca la
      // escribe en la columna que alertasDeVendidos compara.
      vendidosExacto: boolean;
      // Issue #251 (corrección de Pablo, punto 6) — cuándo la
      // extensión LEYÓ la página de verdad (nunca "cuándo llegó al
      // servidor" — background.js puede encolarla y entregarla horas
      // después, punto 4 de la revisión anterior).
      leidoEn: string;
    }
  | { tipoSeguimiento: "tienda"; mlIdExterno: string; totalPublicaciones: number | null; idsVisibles: string[]; leidoEn: string };

// Issue #251 (revisión de Pablo, corrige el diseño anterior de este
// mismo PR) — INSERTA la foto de hoy si todavía no existe (con los
// campos de API en null — la revisión diaria los completa después,
// ver lib/trabajos/revisionDiariaSeguimiento.ts, que ahora usa
// `onConflictDoUpdate` solo para SUS propios campos, nunca para los
// de página) y, si ya existe, la lectura más reciente REEMPLAZA a la
// anterior en los campos de página — "página" es la fuente de verdad
// de inventario/vendidos/publicaciones mientras el seguimiento sea de
// un competidor, así que siempre gana la lectura más fresca, nunca
// "la primera que llegó".
//
// Fecha del día en hora de BOGOTÁ (`fechaDiaBogota`, desde `leidoEn` —
// corrección de Pablo, punto 2), no UTC ni "ahora" — tiene que
// coincidir dígito a dígito con la que usa
// lib/trabajos/revisionDiariaSeguimiento.ts para que las dos fuentes
// compartan la MISMA fila (issue #251, punto 11): si una persona lee
// una ficha a las 8pm en Colombia, con UTC eso ya sería "mañana".
export async function guardarDatoDePaginaSeguimiento(empresaId: string, dato: DatoPaginaSeguimiento): Promise<void> {
  const seguimiento = await buscarSeguimientoActivoPorMlId(empresaId, dato.mlIdExterno);
  if (!seguimiento) return; // no es un seguimiento activo de esta empresa — nunca se inventa ni se cuela de otra

  // Issue #251 (corrección de Pablo, punto 5) — un id de tienda
  // (seller_id, solo dígitos) y uno de producto podrían, en teoría,
  // colisionar entre empresas o tipos — nunca se escriben campos de un
  // tipo (ej. `publicaciones`) sobre un seguimiento del tipo
  // contrario solo porque el `mlIdExterno` coincidió.
  if (dato.tipoSeguimiento !== seguimiento.tipo) {
    console.warn(
      `[lib/seguimiento/seguimientos] guardarDatoDePaginaSeguimiento: tipo "${dato.tipoSeguimiento}" de la extensión no coincide con el seguimiento real (${seguimiento.tipo}) para ${dato.mlIdExterno} — se ignora.`
    );
    return;
  }

  const hoy = fechaDiaBogota(new Date(dato.leidoEn));

  // Issue #251, punto 5 — el total REAL ("752 resultados") viaja con
  // la lista de visibles, dentro del mismo campo jsonb (sin columna
  // aparte); nunca un título falso (`titulo: itemId`) — la extensión
  // solo lee el id de cada tarjeta visible, nunca su título real, así
  // que `titulo` queda `null` (honesto) y quien muestra el mensaje de
  // una alerta cae al itemId recién ahí (lib/seguimiento/alertas.ts).
  // `fuente: "pagina"` (corrección de Pablo) — nunca un snapshot
  // completo, solo lo visible en esa carga; lib/seguimiento/alertas.ts
  // la usa para no comparar nuevas/eliminadas contra esto.
  const camposPagina =
    dato.tipoSeguimiento === "tienda"
      ? {
          publicaciones: {
            total: dato.totalPublicaciones,
            visibles: dato.idsVisibles.map((itemId) => ({ itemId, titulo: null, precio: null })),
            fuente: "pagina" as const,
          },
        }
      : {
          inventarioDisponible: dato.inventario,
          inventarioAproximado: dato.inventarioAproximado,
          // Issue #251 (corrección de Pablo, punto 5) — el "+N"
          // aproximado NUNCA llega a esta columna (la misma que
          // alertasDeVendidos, lib/seguimiento/alertas.ts, compara
          // asumiendo un contador exacto real) — `undefined` la omite
          // del INSERT/UPDATE entero, así que el coalesce de abajo
          // deja intacto lo que ya hubiera (o la deja en null si es la
          // primera foto del día), nunca pisa un dato exacto con uno
          // aproximado ni guarda el aproximado en su lugar.
          vendidos: dato.vendidosExacto ? dato.vendidos : undefined,
        };

  // Issue #251 (corrección de Pablo, punto 5) — COALESCE en el SET del
  // upsert: sin esto, una lectura con un campo en null (ej. la persona
  // abrió la ficha pero el selector de cantidad no cargó a tiempo)
  // BORRABA el dato bueno que ya hubiera de ese mismo día — un dato
  // más parcial pisando uno más completo, justo lo que este diseño
  // (arriba) dice evitar. `excluded` es la fila nueva que se intentó
  // insertar; `seguimiento_fotos` (sin alias) es la fila vieja que ya
  // estaba — sintaxis real de upsert de Postgres, no un helper de
  // Drizzle (no hay un objeto que represente `excluded`).
  const setDelConflicto =
    dato.tipoSeguimiento === "tienda"
      ? { publicaciones: sql`coalesce(excluded.publicaciones, seguimiento_fotos.publicaciones)` }
      : {
          inventarioDisponible: sql`coalesce(excluded.inventario_disponible, seguimiento_fotos.inventario_disponible)`,
          inventarioAproximado: sql`coalesce(excluded.inventario_aproximado, seguimiento_fotos.inventario_aproximado)`,
          vendidos: sql`coalesce(excluded.vendidos, seguimiento_fotos.vendidos)`,
        };

  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(seguimientoFotos)
      .values({ empresaId, seguimientoId: seguimiento.id, fecha: hoy, ...camposPagina })
      .onConflictDoUpdate({ target: [seguimientoFotos.seguimientoId, seguimientoFotos.fecha], set: setDelConflicto })
  );
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

  if (datos.esCompetidor) await verificarCupoCompetidor(empresaId, datos.tipo);

  const token = await tokenPropio(empresaId);

  // Issue #250, punto A — confirmar item/product contra Mercado Libre
  // ANTES de guardar (nunca se guarda solo lo que adivinó el texto del
  // link): corrige en el momento el caso real del bug (un id de
  // catálogo pegado sin "/p/" en la URL, que el texto solo clasifica
  // como "item"). confirmarRecursoProductoMl nunca recibe el token de
  // la cuenta (corrección de Pablo, revisión del PR #253) — es solo
  // una verificación de existencia, no hace falta gastar ni arriesgar
  // un token de la app compartida de Mercado Libre por esto.
  //
  // Punto 4 de esa misma revisión — tres resultados reales, cada uno
  // con su propio manejo: "confirmado" corrige el tipo; "no_encontrado"
  // (los DOS, /items Y /products, dieron 404 real) rechaza el alta con
  // un mensaje claro, nunca guarda un recurso que Mercado Libre
  // confirmó que no existe; "transitorio" (403/5xx, nunca bloquea)
  // sigue con lo que ya interpretó el texto del link, con un aviso en
  // el log — scripts/corregir-tipo-recurso-seguimiento.ts corrige
  // después los que de verdad hayan quedado mal guardados por esto.
  if (datos.tipo === "producto") {
    const confirmacion = await confirmarRecursoProductoMl(interpretado.mlIdExterno);
    if (confirmacion.estado === "confirmado") {
      interpretado = { recursoMl: confirmacion.recursoMl, mlIdExterno: interpretado.mlIdExterno };
    } else if (confirmacion.estado === "no_encontrado") {
      throw new LinkMlInvalidoError("No encontramos ese producto en Mercado Libre — revisá el link o el id.");
    } else {
      console.warn(
        `[lib/seguimiento/seguimientos] no se pudo confirmar el tipo de ${interpretado.mlIdExterno} contra Mercado Libre (403/5xx transitorio) — se guarda como "${interpretado.recursoMl}", el tipo que interpretó el link.`
      );
    }
  }

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
