// Optimización — bitácora de cambios de una publicación:
// - los cambios hechos desde Optimización, de la auditoría (precio,
//   título, fotos, pausar/activar: quién, cuándo, antes y después);
// - las notas a mano para cambios hechos fuera de Zilonix
//   (optimizacion_notas, migración 0035);
// - la revisión de cada uno (optimizacion_revisiones): sirvió, no sirvió
//   o sin cambio, con un comentario. Desde la 0036 puede ser solo un
//   comentario (resultado null): ese cambio sigue «sin revisar».
// El resultado a los 7 días se calcula en bitacoraResultado.ts.

import { and, desc, eq, gte, ilike, inArray, isNotNull, like, lte } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { registrarAuditoria } from "@/lib/auditoria";
import type { db } from "@/db";
import { auditoria, cuentasMl, optimizacionNotas, optimizacionRevisiones, usuarios } from "@/db/schema";
import { hoyBogota, restarDiasIso } from "@/lib/publicidad/plan";
import { ACCIONES_BITACORA, compactarFotos, DIAS_AVISO_REVISION, DIAS_MEDICION, LARGO_MAXIMO_VALOR_FOTOS, leerFotosCompactas, listoParaRevisar, MARCA_FOTO_IA_ROTULO as MARCA_FOTO_IA, type ResultadoRevision } from "./bitacoraResultado";

export { ACCIONES_BITACORA, DIAS_AVISO_REVISION, DIAS_MEDICION, compactarFotos, leerFotosCompactas, LARGO_MAXIMO_VALOR_FOTOS, MARCA_FOTO_IA };

const ACCIONES = Object.keys(ACCIONES_BITACORA);

// ---------- Registro de cada cambio (sin migración) ----------
// La cuenta de Mercado Libre se guarda en la columna `detalle` de
// auditoría, al final, con un marcador fijo: « [cuenta:<uuid>]». La vista
// lo quita al mostrar. Las filas viejas no lo tienen y siguen sirviendo.
const PATRON_MARCADOR_CUENTA = / \[cuenta:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\s*$/i;

export function armarDetalleCambio(detalle: string, cuentaMlId: string | null | undefined): string {
  const limpio = quitarCuentaDeDetalle(detalle);
  return cuentaMlId && /^[0-9a-f-]{36}$/i.test(cuentaMlId) ? `${limpio} [cuenta:${cuentaMlId}]` : limpio;
}

export function leerCuentaDeDetalle(detalle: string | null | undefined): string | null {
  const m = typeof detalle === "string" ? PATRON_MARCADOR_CUENTA.exec(detalle) : null;
  return m ? m[1].toLowerCase() : null;
}

export function quitarCuentaDeDetalle(detalle: string | null | undefined): string {
  return typeof detalle === "string" ? detalle.replace(PATRON_MARCADOR_CUENTA, "") : "";
}

export type EntradaCambioOptimizacion = {
  empresaId: string;
  usuarioId: string;
  cuentaMlId: string;
  cuentaNickname: string;
  itemId: string;
  accion: string;
  valorAnterior?: string;
  valorNuevo?: string;
  detalle: string;
};

// Todo guardado de Optimización se registra por acá, dentro de la misma
// transacción (dbComoEmpresa) de quien llama.
export async function registrarCambioOptimizacion(tx: typeof db, e: EntradaCambioOptimizacion): Promise<void> {
  await registrarAuditoria(tx, {
    empresaId: e.empresaId,
    usuarioId: e.usuarioId,
    actorTipo: "persona",
    accion: e.accion,
    entidad: "publicacion_ml",
    entidadId: e.itemId,
    detalle: armarDetalleCambio(e.detalle, e.cuentaMlId),
    valorAnterior: e.valorAnterior,
    valorNuevo: e.valorNuevo,
  });
}

export type RevisionCambio = { resultado: ResultadoRevision | null; comentario: string | null; usuario: string | null; ts: Date };

export type CambioBitacora = {
  id: string;
  // "auditoria:<id>" o "nota:<id>": la llave de su revisión.
  ref: string;
  origen: "zilonix" | "nota";
  accion: string;
  rotulo: string;
  ts: Date;
  dia: string; // YYYY-MM-DD de Bogotá
  usuario: string | null;
  valorAnterior: string | null;
  valorNuevo: string | null;
  detalle: string | null;
  // Cuenta guardada en el marcador del detalle (null en filas viejas y notas).
  cuentaMlId?: string | null;
  revision: RevisionCambio | null;
};

export async function leerCambiosPublicacion(empresaId: string, itemId: string, limite = 50): Promise<CambioBitacora[]> {
  const [desdeZilonix, notas, revisiones] = await dbComoEmpresa(empresaId, (tx) =>
    Promise.all([
      tx
        .select({
          id: auditoria.id,
          accion: auditoria.accion,
          ts: auditoria.ts,
          usuario: usuarios.nombre,
          valorAnterior: auditoria.valorAnterior,
          valorNuevo: auditoria.valorNuevo,
          detalle: auditoria.detalle,
        })
        .from(auditoria)
        .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
        .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.entidad, "publicacion_ml"), eq(auditoria.entidadId, itemId), inArray(auditoria.accion, ACCIONES)))
        .orderBy(desc(auditoria.ts))
        .limit(limite),
      tx
        .select({ id: optimizacionNotas.id, ts: optimizacionNotas.fechaCambio, texto: optimizacionNotas.texto, usuario: usuarios.nombre })
        .from(optimizacionNotas)
        .leftJoin(usuarios, eq(usuarios.id, optimizacionNotas.usuarioId))
        .where(and(eq(optimizacionNotas.empresaId, empresaId), eq(optimizacionNotas.itemId, itemId)))
        .orderBy(desc(optimizacionNotas.fechaCambio))
        .limit(limite),
      tx
        .select({
          ref: optimizacionRevisiones.cambioRef,
          resultado: optimizacionRevisiones.resultado,
          comentario: optimizacionRevisiones.comentario,
          usuario: usuarios.nombre,
          ts: optimizacionRevisiones.revisadoTs,
        })
        .from(optimizacionRevisiones)
        .leftJoin(usuarios, eq(usuarios.id, optimizacionRevisiones.usuarioId))
        .where(and(eq(optimizacionRevisiones.empresaId, empresaId), eq(optimizacionRevisiones.itemId, itemId))),
    ])
  );
  const porRef = new Map(revisiones.map((r) => [r.ref, { resultado: r.resultado as ResultadoRevision | null, comentario: r.comentario, usuario: r.usuario, ts: r.ts }]));
  const cambios: CambioBitacora[] = [
    ...desdeZilonix.map((f) => ({
      ...f,
      detalle: f.detalle === null ? null : quitarCuentaDeDetalle(f.detalle),
      cuentaMlId: leerCuentaDeDetalle(f.detalle),
      ref: `auditoria:${f.id}`,
      origen: "zilonix" as const,
      rotulo: ACCIONES_BITACORA[f.accion] ?? f.accion,
      dia: hoyBogota(f.ts),
      revision: porRef.get(`auditoria:${f.id}`) ?? null,
    })),
    ...notas.map((n) => ({
      id: n.id,
      ref: `nota:${n.id}`,
      origen: "nota" as const,
      accion: "nota",
      rotulo: "Nota",
      ts: n.ts,
      dia: hoyBogota(n.ts),
      usuario: n.usuario,
      valorAnterior: null,
      valorNuevo: null,
      detalle: n.texto,
      revision: porRef.get(`nota:${n.id}`) ?? null,
    })),
  ];
  return cambios.sort((a, b) => b.ts.getTime() - a.ts.getTime()).slice(0, limite);
}

// Publicaciones de la lista con algún cambio (de Zilonix o anotado) que
// ya cumplió su semana de medición, todavía sin resultado (un comentario
// solo no cuenta como revisado) y de hace no más
// de 14 días. Cuenta en días de calendario de Bogotá, igual que el
// detalle, para que «Revisar cambio» y «Mejoró/Empeoró» coincidan.
export async function publicacionesParaRevisar(empresaId: string, itemIds: string[], ahora: Date): Promise<string[]> {
  if (itemIds.length === 0) return [];
  const hoy = hoyBogota(ahora);
  // Un margen de 2 días para cubrir el corte de Bogotá; el filtro fino es por día.
  const desde = new Date(ahora.getTime() - (DIAS_AVISO_REVISION + 2) * 86_400_000);
  const [desdeZilonix, notas, revisadas] = await dbComoEmpresa(empresaId, (tx) =>
    Promise.all([
      tx
        .select({ id: auditoria.id, itemId: auditoria.entidadId, ts: auditoria.ts })
        .from(auditoria)
        .where(
          and(
            eq(auditoria.empresaId, empresaId),
            eq(auditoria.entidad, "publicacion_ml"),
            inArray(auditoria.entidadId, itemIds),
            inArray(auditoria.accion, ACCIONES),
            gte(auditoria.ts, desde)
          )
        ),
      tx
        .select({ id: optimizacionNotas.id, itemId: optimizacionNotas.itemId, ts: optimizacionNotas.fechaCambio })
        .from(optimizacionNotas)
        .where(and(eq(optimizacionNotas.empresaId, empresaId), inArray(optimizacionNotas.itemId, itemIds), gte(optimizacionNotas.fechaCambio, desde))),
      tx
        .select({ ref: optimizacionRevisiones.cambioRef })
        .from(optimizacionRevisiones)
        .where(and(eq(optimizacionRevisiones.empresaId, empresaId), inArray(optimizacionRevisiones.itemId, itemIds), isNotNull(optimizacionRevisiones.resultado))),
    ])
  );
  const yaRevisadas = new Set(revisadas.map((r) => r.ref));
  const pendientes = new Set<string>();
  const revisar = (ref: string, itemId: string | null, ts: Date) => {
    if (itemId && !yaRevisadas.has(ref) && listoParaRevisar(hoyBogota(ts), hoy)) pendientes.add(itemId);
  };
  for (const c of desdeZilonix) revisar(`auditoria:${c.id}`, c.itemId, c.ts);
  for (const n of notas) revisar(`nota:${n.id}`, n.itemId, n.ts);
  return [...pendientes];
}

// El cambio que se va a revisar existe y es de esta publicación (nunca se
// confía en la referencia que manda el navegador).
export async function cambioEsDeLaPublicacion(empresaId: string, ref: string, itemId: string): Promise<boolean> {
  const [tipo, id] = ref.split(":");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return false;
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tipo === "auditoria"
      ? tx
          .select({ id: auditoria.id })
          .from(auditoria)
          .where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.id, id), eq(auditoria.entidad, "publicacion_ml"), eq(auditoria.entidadId, itemId)))
      : tipo === "nota"
        ? tx
            .select({ id: optimizacionNotas.id })
            .from(optimizacionNotas)
            .where(and(eq(optimizacionNotas.empresaId, empresaId), eq(optimizacionNotas.id, id), eq(optimizacionNotas.itemId, itemId)))
        : Promise.resolve([])
  );
  return filas.length > 0;
}

// Día (Bogotá) de un cambio ya verificado con cambioEsDeLaPublicacion.
export async function diaDelCambio(empresaId: string, ref: string): Promise<string | null> {
  const [tipo, id] = ref.split(":");
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) return null;
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tipo === "auditoria"
      ? tx.select({ ts: auditoria.ts }).from(auditoria).where(and(eq(auditoria.empresaId, empresaId), eq(auditoria.id, id)))
      : tipo === "nota"
        ? tx.select({ ts: optimizacionNotas.fechaCambio }).from(optimizacionNotas).where(and(eq(optimizacionNotas.empresaId, empresaId), eq(optimizacionNotas.id, id)))
        : Promise.resolve([])
  );
  return filas[0] ? hoyBogota(filas[0].ts) : null;
}

export async function crearNotaBitacora(
  empresaId: string,
  datos: { usuarioId: string; cuentaMlId: string; itemId: string; fechaCambio: Date; texto: string }
): Promise<string> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(optimizacionNotas)
      .values({ empresaId, ...datos })
      .returning({ id: optimizacionNotas.id })
  );
  return fila.id;
}

// Una revisión por cambio: si se vuelve a revisar, se actualiza.
// resultado null = solo comentario (la base exige al menos uno de los dos).
export async function guardarRevisionCambio(
  empresaId: string,
  datos: { usuarioId: string; ref: string; itemId: string; resultado: ResultadoRevision | null; comentario: string | null }
): Promise<void> {
  const ahora = new Date();
  await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(optimizacionRevisiones)
      .values({ empresaId, cambioRef: datos.ref, itemId: datos.itemId, resultado: datos.resultado, comentario: datos.comentario, usuarioId: datos.usuarioId, revisadoTs: ahora })
      .onConflictDoUpdate({
        target: [optimizacionRevisiones.empresaId, optimizacionRevisiones.cambioRef],
        set: { resultado: datos.resultado, comentario: datos.comentario, usuarioId: datos.usuarioId, revisadoTs: ahora },
      })
  );
}

// ---------- Bitácora general (todas las publicaciones) ----------

export const POR_PAGINA_BITACORA = 25;
export const DIAS_MAXIMOS_BITACORA = 90;
export const ESTADOS_BITACORA = ["midiendo", "listo", "revisado", "sin_revisar"] as const;
export type EstadoBitacora = (typeof ESTADOS_BITACORA)[number];

export type FiltrosBitacoraGeneral = {
  cuentaMlId?: string;
  accion?: string;
  usuarioId?: string;
  desde?: string; // YYYY-MM-DD de Bogotá
  hasta?: string;
  estado?: EstadoBitacora;
  itemId?: string;
  pagina?: number;
};

export type CambioGeneral = Omit<CambioBitacora, "origen" | "detalle"> & {
  origen: "zilonix";
  itemId: string;
  cuentaMlId: string | null;
  cuentaNickname: string | null;
  detalle: string; // sin el marcador de cuenta
  estado: EstadoBitacora;
};

export type PaginaBitacoraGeneral = { filas: CambioGeneral[]; total: number; pagina: number; paginas: number };

// Estado de un cambio: «revisado» si tiene resultado; si no, «midiendo»
// hasta terminar los 7 días, y después «listo» para revisar (o, pasados
// los 14 días del aviso, solo «sin revisar»).
export function estadoDeCambio(dia: string, hoy: string, revision: RevisionCambio | null): EstadoBitacora {
  if (revision?.resultado) return "revisado";
  if (restarDiasIso(dia, -(DIAS_MEDICION - 1)) >= hoy) return "midiendo";
  return listoParaRevisar(dia, hoy) ? "listo" : "sin_revisar";
}

function coincideEstado(filtro: EstadoBitacora, estado: EstadoBitacora): boolean {
  // «sin revisar» incluye todo lo que aún no tiene resultado.
  return filtro === "sin_revisar" ? estado !== "revisado" : filtro === estado;
}

const UUID_FILTRO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ITEM_FILTRO = /^[A-Za-z0-9_-]{3,40}$/;

// Todos los cambios hechos desde Optimización, últimos 90 días, 25 por
// página. Filtros por cuenta (marcador en `detalle`), tipo, quién, días de
// Bogotá, estado e id de publicación; todos van como parámetros. El
// estado depende de las revisiones, así que se filtra y pagina en memoria
// sobre las filas ya acotadas por la base (tope 2000).
export async function leerCambiosGenerales(empresaId: string, filtros: FiltrosBitacoraGeneral, ahora: Date = new Date()): Promise<PaginaBitacoraGeneral> {
  const hoy = hoyBogota(ahora);
  const piso = restarDiasIso(hoy, DIAS_MAXIMOS_BITACORA - 1);
  const desde = filtros.desde && filtros.desde > piso ? filtros.desde : piso;
  const condiciones = [
    eq(auditoria.empresaId, empresaId),
    eq(auditoria.entidad, "publicacion_ml"),
    inArray(auditoria.accion, filtros.accion && ACCIONES.includes(filtros.accion) ? [filtros.accion] : ACCIONES),
    // Un margen de un día para el corte de Bogotá; el filtro fino es por día.
    gte(auditoria.ts, new Date(`${restarDiasIso(desde, 1)}T00:00:00Z`)),
  ];
  if (filtros.hasta) condiciones.push(lte(auditoria.ts, new Date(`${restarDiasIso(filtros.hasta, -2)}T00:00:00Z`)));
  if (filtros.cuentaMlId && UUID_FILTRO.test(filtros.cuentaMlId)) condiciones.push(like(auditoria.detalle, `%[cuenta:${filtros.cuentaMlId.toLowerCase()}]`));
  if (filtros.usuarioId && UUID_FILTRO.test(filtros.usuarioId)) condiciones.push(eq(auditoria.usuarioId, filtros.usuarioId));
  if (filtros.itemId && ITEM_FILTRO.test(filtros.itemId)) condiciones.push(ilike(auditoria.entidadId, `%${filtros.itemId.replace(/[%_\\]/g, "")}%`));

  const [filasBase, revisiones, cuentas] = await dbComoEmpresa(empresaId, (tx) =>
    Promise.all([
      tx
        .select({
          id: auditoria.id,
          itemId: auditoria.entidadId,
          accion: auditoria.accion,
          ts: auditoria.ts,
          usuario: usuarios.nombre,
          valorAnterior: auditoria.valorAnterior,
          valorNuevo: auditoria.valorNuevo,
          detalle: auditoria.detalle,
        })
        .from(auditoria)
        .leftJoin(usuarios, eq(usuarios.id, auditoria.usuarioId))
        .where(and(...condiciones))
        .orderBy(desc(auditoria.ts))
        .limit(2000),
      tx
        .select({
          ref: optimizacionRevisiones.cambioRef,
          resultado: optimizacionRevisiones.resultado,
          comentario: optimizacionRevisiones.comentario,
          usuario: usuarios.nombre,
          ts: optimizacionRevisiones.revisadoTs,
        })
        .from(optimizacionRevisiones)
        .leftJoin(usuarios, eq(usuarios.id, optimizacionRevisiones.usuarioId))
        .where(eq(optimizacionRevisiones.empresaId, empresaId)),
      tx.select({ id: cuentasMl.id, nickname: cuentasMl.nickname }).from(cuentasMl).where(eq(cuentasMl.empresaId, empresaId)),
    ])
  );
  const porRef = new Map(revisiones.map((r) => [r.ref, { resultado: r.resultado as ResultadoRevision | null, comentario: r.comentario, usuario: r.usuario, ts: r.ts }]));
  const nicknames = new Map(cuentas.map((c) => [c.id, c.nickname]));

  const todas: CambioGeneral[] = [];
  for (const f of filasBase) {
    if (!f.itemId) continue;
    const dia = hoyBogota(f.ts);
    if (dia < desde || (filtros.hasta && dia > filtros.hasta)) continue;
    const cuentaMlId = leerCuentaDeDetalle(f.detalle);
    const revision = porRef.get(`auditoria:${f.id}`) ?? null;
    todas.push({
      id: f.id,
      ref: `auditoria:${f.id}`,
      origen: "zilonix",
      itemId: f.itemId,
      accion: f.accion,
      rotulo: ACCIONES_BITACORA[f.accion] ?? f.accion,
      ts: f.ts,
      dia,
      usuario: f.usuario,
      valorAnterior: f.valorAnterior,
      valorNuevo: f.valorNuevo,
      detalle: quitarCuentaDeDetalle(f.detalle),
      cuentaMlId,
      cuentaNickname: cuentaMlId ? (nicknames.get(cuentaMlId) ?? null) : null,
      revision,
      estado: estadoDeCambio(dia, hoy, revision),
    });
  }
  const filtradas = filtros.estado && ESTADOS_BITACORA.includes(filtros.estado) ? todas.filter((c) => coincideEstado(filtros.estado!, c.estado)) : todas;
  const paginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA_BITACORA));
  const pagina = Math.min(Math.max(1, Math.floor(filtros.pagina ?? 1) || 1), paginas);
  return { filas: filtradas.slice((pagina - 1) * POR_PAGINA_BITACORA, pagina * POR_PAGINA_BITACORA), total: filtradas.length, pagina, paginas };
}
