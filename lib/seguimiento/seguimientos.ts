import { and, desc, eq, isNull } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { seguimientoAlertas, seguimientoFotos, seguimientosMl } from "@/db/schema";
import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { obtenerItemMl, obtenerProducto, obtenerVendedor } from "@/lib/ml/cliente";
import { esLinkDeTienda, esLinkTiendaOficialSinIdDeVendedor, interpretarEnlaceProducto, interpretarEnlaceTienda } from "@/lib/seguimiento/link";

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

// Nombre para mostrar en la lista, resuelto una sola vez al agregar
// (igual que invitaciones.empresa_nombre/rol_nombre) con las funciones
// YA existentes de lib/ml/cliente.ts — nunca una llamada nueva. Si
// Mercado Libre no deja ver el nombre (enriquecimiento opcional, igual
// que en investigacion.ts), se usa el id tal cual en vez de fallar
// toda la operación de agregar.
async function resolverNombre(tipo: "producto" | "tienda", recursoMl: "item" | "product" | "seller", mlIdExterno: string, token: string): Promise<string> {
  try {
    if (tipo === "tienda") {
      const vendedor = await obtenerVendedor(mlIdExterno, token);
      return vendedor?.nickname ?? mlIdExterno;
    }
    if (recursoMl === "item") {
      const item = await obtenerItemMl(mlIdExterno, token);
      return item?.producto.nombre ?? mlIdExterno;
    }
    const producto = await obtenerProducto(mlIdExterno, token);
    return producto?.nombre ?? mlIdExterno;
  } catch {
    return mlIdExterno;
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
};

// Lista para /panel/investigacion/seguimiento — precio, inventario,
// vendidos, catálogo y ganador vienen de la ÚLTIMA foto (nunca de un
// cálculo en vivo contra Mercado Libre: esta pantalla lee lo que ya
// guardó la revisión diaria). N+1 a propósito: el volumen esperado por
// empresa es bajo (máx. 5 competidores + algunos productos/tiendas
// propios), nunca cientos de filas que justifiquen una consulta más
// compleja.
export async function listarSeguimientosConUltimaFoto(empresaId: string): Promise<SeguimientoConUltimaFoto[]> {
  return dbComoEmpresa(empresaId, async (tx) => {
    const activos = await tx.select().from(seguimientosMl).where(and(eq(seguimientosMl.empresaId, empresaId), isNull(seguimientosMl.eliminadoTs))).orderBy(desc(seguimientosMl.creadoTs));

    const resultado: SeguimientoConUltimaFoto[] = [];
    for (const seguimiento of activos) {
      const [ultimaFoto] = await tx
        .select()
        .from(seguimientoFotos)
        .where(eq(seguimientoFotos.seguimientoId, seguimiento.id))
        .orderBy(desc(seguimientoFotos.fecha))
        .limit(1);
      resultado.push({ seguimiento, ultimaFoto: ultimaFoto ?? null });
    }
    return resultado;
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
