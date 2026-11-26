import { randomUUID } from "crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas3pl, entregasDomiciliario, entregasDomiciliarioContacto, miembrosBodega3pl, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { registrarAuditoriaBodega } from "@/lib/bodega/auditoria";
import { normalizarDatosEntrega, type DatosEntrega } from "./datos";

export class EntregaInvalidaError extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "EntregaInvalidaError";
  }
}

export type DomiciliarioAsignable = { miembroId: string; bodegaId: string; bodegaNombre: string; nombre: string };

// Lo que ve el VENDEDOR. La política de miembros_bodega_3pl ya limita a
// domiciliarios ACTIVOS de bodegas con vínculo activo con esta empresa; el
// filtro de abajo solo ordena y acota las columnas que se leen.
export async function listarDomiciliariosAsignables(empresaId: string): Promise<DomiciliarioAsignable[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ miembroId: miembrosBodega3pl.id, bodegaId: bodegas3pl.id, bodegaNombre: bodegas3pl.nombre, nombre: usuarios.nombre })
      .from(miembrosBodega3pl)
      .innerJoin(bodegas3pl, eq(bodegas3pl.id, miembrosBodega3pl.bodegaId))
      .innerJoin(usuarios, eq(usuarios.id, miembrosBodega3pl.usuarioId))
      .where(and(eq(miembrosBodega3pl.rol, "domiciliario"), eq(miembrosBodega3pl.activo, true)))
      .orderBy(asc(bodegas3pl.nombre), asc(usuarios.nombre))
  );
}

export type EntregaDePedido = { id: string; pedidoReferencia: string; estado: string; motivo: string | null; miembroDomiciliarioId: string; domiciliarioNombre: string; tieneFoto: boolean } & DatosEntrega;

// Entregas ya asignadas a estos pedidos (para pintar «Asignado a …» y
// precargar el formulario al reasignar). La empresa conserva sus datos.
export async function listarEntregasDePedidos(empresaId: string, marketplace: string, referencias: string[]): Promise<EntregaDePedido[]> {
  if (referencias.length === 0) return [];
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        id: entregasDomiciliario.id,
        pedidoReferencia: entregasDomiciliario.pedidoReferencia,
        estado: entregasDomiciliario.estado,
        motivo: entregasDomiciliario.motivo,
        miembroDomiciliarioId: entregasDomiciliario.miembroDomiciliarioId,
        domiciliarioNombre: usuarios.nombre,
        // Domi-3: al vendedor solo le llega si hay foto; la foto misma se
        // pide aparte a /api/entregas/[id]/foto.
        tieneFoto: sql<boolean>`${entregasDomiciliario.fotoPublicId} is not null`,
        receptorNombre: entregasDomiciliarioContacto.receptorNombre,
        direccion: entregasDomiciliarioContacto.direccion,
        barrio: entregasDomiciliarioContacto.barrio,
        ciudad: entregasDomiciliarioContacto.ciudad,
        telefono: entregasDomiciliarioContacto.telefono,
        nota: entregasDomiciliarioContacto.nota,
      })
      .from(entregasDomiciliario)
      .innerJoin(entregasDomiciliarioContacto, eq(entregasDomiciliarioContacto.entregaId, entregasDomiciliario.id))
      .innerJoin(miembrosBodega3pl, eq(miembrosBodega3pl.id, entregasDomiciliario.miembroDomiciliarioId))
      .innerJoin(usuarios, eq(usuarios.id, miembrosBodega3pl.usuarioId))
      .where(and(eq(entregasDomiciliario.empresaId, empresaId), eq(entregasDomiciliario.marketplace, marketplace), inArray(entregasDomiciliario.pedidoReferencia, referencias)))
  );
}

// Asignar o reasignar. Un pedido tiene a lo sumo una entrega (índice
// único). Reasignar solo se permite mientras siga 'asignada' (RLS lo
// refuerza). El domiciliario elegido debe ser activo y de una bodega
// ligada y activa: lo comprueban las políticas (WITH CHECK), no solo esto.
export async function asignarEntrega(
  empresaId: string,
  usuarioId: string,
  entrada: { miembroId: string; marketplace: string; pedidoReferencia: string; datos: Parameters<typeof normalizarDatosEntrega>[0] }
): Promise<{ accion: "asignada" | "reasignada" }> {
  const datos = normalizarDatosEntrega(entrada.datos);
  const referencia = entrada.pedidoReferencia.trim();
  if (!referencia) throw new EntregaInvalidaError("Falta la referencia del pedido.");
  return dbComoEmpresa(empresaId, async (tx) => {
    const [miembro] = await tx
      .select({ id: miembrosBodega3pl.id, bodegaId: miembrosBodega3pl.bodegaId })
      .from(miembrosBodega3pl)
      .where(and(eq(miembrosBodega3pl.id, entrada.miembroId), eq(miembrosBodega3pl.rol, "domiciliario"), eq(miembrosBodega3pl.activo, true)));
    if (!miembro) throw new EntregaInvalidaError("Ese domiciliario no está disponible para tu empresa.");

    const [actual] = await tx
      .select()
      .from(entregasDomiciliario)
      .where(and(eq(entregasDomiciliario.empresaId, empresaId), eq(entregasDomiciliario.marketplace, entrada.marketplace), eq(entregasDomiciliario.pedidoReferencia, referencia)));

    if (actual && actual.estado !== "asignada") throw new EntregaInvalidaError("La entrega ya salió con el domiciliario; no se puede reasignar.");

    let accion: "asignada" | "reasignada" = "asignada";
    let entregaId = actual?.id ?? randomUUID();
    if (actual) {
      accion = "reasignada";
      if (actual.bodegaId !== miembro.bodegaId) {
        // bodega_id no se edita: cambiar de bodega es quitar y volver a crear.
        await tx.delete(entregasDomiciliario).where(eq(entregasDomiciliario.id, actual.id));
      } else {
        const filas = await tx
          .update(entregasDomiciliario)
          .set({ miembroDomiciliarioId: miembro.id, actualizadaTs: new Date() })
          .where(eq(entregasDomiciliario.id, actual.id))
          .returning({ id: entregasDomiciliario.id });
        if (filas.length === 0) throw new EntregaInvalidaError("No se pudo reasignar la entrega.");
        // Cabecera y contacto, en la misma transacción.
        await tx.update(entregasDomiciliarioContacto).set(datos).where(eq(entregasDomiciliarioContacto.entregaId, actual.id));
      }
    }
    if (!actual || actual.bodegaId !== miembro.bodegaId) {
      entregaId = randomUUID();
      await tx.insert(entregasDomiciliario).values({
        id: entregaId,
        empresaId,
        bodegaId: miembro.bodegaId,
        miembroDomiciliarioId: miembro.id,
        marketplace: entrada.marketplace,
        pedidoReferencia: referencia,
      });
      await tx.insert(entregasDomiciliarioContacto).values({ entregaId, empresaId, ...datos });
    }
    // Detalle sin datos del comprador: solo la referencia del pedido.
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: accion === "asignada" ? "asignar_domiciliario" : "reasignar_domiciliario",
      entidad: "entrega_domiciliario",
      entidadId: referencia,
      detalle: `${accion === "asignada" ? "Asignó" : "Reasignó"} el pedido ${referencia} a un domiciliario.`,
    });
    return { accion };
  });
}

export async function quitarEntrega(empresaId: string, usuarioId: string, marketplace: string, pedidoReferencia: string): Promise<void> {
  await dbComoEmpresa(empresaId, async (tx) => {
    const filas = await tx
      .delete(entregasDomiciliario)
      .where(and(eq(entregasDomiciliario.empresaId, empresaId), eq(entregasDomiciliario.marketplace, marketplace), eq(entregasDomiciliario.pedidoReferencia, pedidoReferencia), eq(entregasDomiciliario.estado, "asignada")))
      .returning({ id: entregasDomiciliario.id });
    if (filas.length === 0) throw new EntregaInvalidaError("No hay una entrega por quitar (o ya salió con el domiciliario).");
    await registrarAuditoria(tx, {
      empresaId,
      usuarioId,
      actorTipo: "persona",
      accion: "quitar_domiciliario",
      entidad: "entrega_domiciliario",
      entidadId: pedidoReferencia,
      detalle: `Quitó el domiciliario del pedido ${pedidoReferencia}.`,
    });
  });
}

// Domi-3: la foto de una entrega, para el VENDEDOR (RLS: solo de su
// empresa). null si no existe, es de otra empresa o no tiene foto.
export async function fotoDeEntrega(empresaId: string, entregaId: string): Promise<string | null> {
  const [fila] = await dbComoEmpresa(empresaId, (tx) =>
    tx.select({ fotoPublicId: entregasDomiciliario.fotoPublicId }).from(entregasDomiciliario).where(and(eq(entregasDomiciliario.id, entregaId), eq(entregasDomiciliario.empresaId, empresaId)))
  );
  return fila?.fotoPublicId ?? null;
}

// ── Para Domi-2 (#629), desde /domiciliario con accesoBodega("domiciliario") ──
// La base devuelve solo las filas SUYAS (cualquier estado) y los datos del
// comprador solo si la entrega sigue abierta (política del contacto).
export async function listarMisEntregas(bodegaId: string, usuarioId: string) {
  return dbComoBodega(
    bodegaId,
    // LEFT JOIN: con la entrega cerrada la política del contacto no devuelve
    // la fila y esos campos llegan en null (el historial queda, sin datos).
    (tx) =>
      tx
        .select({
          id: entregasDomiciliario.id,
          pedidoReferencia: entregasDomiciliario.pedidoReferencia,
          marketplace: entregasDomiciliario.marketplace,
          estado: entregasDomiciliario.estado,
          motivo: entregasDomiciliario.motivo,
          asignadaTs: entregasDomiciliario.asignadaTs,
          actualizadaTs: entregasDomiciliario.actualizadaTs,
          receptorNombre: entregasDomiciliarioContacto.receptorNombre,
          direccion: entregasDomiciliarioContacto.direccion,
          barrio: entregasDomiciliarioContacto.barrio,
          ciudad: entregasDomiciliarioContacto.ciudad,
          telefono: entregasDomiciliarioContacto.telefono,
          nota: entregasDomiciliarioContacto.nota,
        })
        .from(entregasDomiciliario)
        .leftJoin(entregasDomiciliarioContacto, eq(entregasDomiciliarioContacto.entregaId, entregasDomiciliario.id))
        .orderBy(asc(entregasDomiciliario.asignadaTs)),
    "domiciliario",
    usuarioId
  );
}

export type EstadoNuevoEntrega = "en_camino" | "entregada" | "no_entregada";

// Domi-3: antes de subir la foto se confirma que la entrega es SUYA y sigue
// abierta (RLS limita a sus filas). Devuelve la empresa, para la carpeta de
// la foto. Así nadie sube fotos a Cloudinary con un id de entrega ajeno.
export async function miEntregaAbierta(bodegaId: string, usuarioId: string, entregaId: string): Promise<{ empresaId: string }> {
  return dbComoBodega(
    bodegaId,
    async (tx) => {
      const [propia] = await tx.select({ estado: entregasDomiciliario.estado, empresaId: entregasDomiciliario.empresaId }).from(entregasDomiciliario).where(eq(entregasDomiciliario.id, entregaId));
      if (!propia || propia.estado === "entregada" || propia.estado === "no_entregada") throw new EntregaInvalidaError("Esa entrega no está disponible.");
      return { empresaId: propia.empresaId };
    },
    "domiciliario",
    usuarioId
  );
}

export async function cambiarEstadoMiEntrega(bodegaId: string, usuarioId: string, entregaId: string, nuevo: EstadoNuevoEntrega, motivo?: string, fotoPublicId?: string): Promise<void> {
  const motivoLimpio = motivo?.trim() || null;
  if (nuevo === "no_entregada" && !motivoLimpio) throw new EntregaInvalidaError("Indica el motivo de la no entrega.");
  // Domi-3: «Entregado» exige la foto (también lo exige la base, política
  // entrega_entregada_con_foto). En otro estado nunca se guarda una foto.
  if (nuevo === "entregada" && !fotoPublicId) throw new EntregaInvalidaError("Toma la foto de la entrega para confirmarla.");
  await dbComoBodega(
    bodegaId,
    async (tx) => {
      // Se lee antes (la política solo deja ver las suyas). La política de
      // UPDATE solo deja cerrar las abiertas: una cerrada afecta 0 filas.
      const [propia] = await tx.select({ id: entregasDomiciliario.id, estado: entregasDomiciliario.estado, empresaId: entregasDomiciliario.empresaId }).from(entregasDomiciliario).where(eq(entregasDomiciliario.id, entregaId));
      if (!propia || propia.estado === "entregada" || propia.estado === "no_entregada") throw new EntregaInvalidaError("Esa entrega no está disponible.");
      if (nuevo === "en_camino" && propia.estado !== "asignada") throw new EntregaInvalidaError("Esa entrega ya salió.");
      // .returning(): un UPDATE filtrado por RLS no falla, afecta 0 filas.
      const filas = await tx
        .update(entregasDomiciliario)
        .set({
          estado: nuevo,
          motivo: nuevo === "no_entregada" ? motivoLimpio : null,
          actualizadaTs: new Date(),
          ...(nuevo === "entregada" ? { fotoPublicId, fotoTs: new Date() } : {}),
        })
        .where(eq(entregasDomiciliario.id, entregaId))
        .returning({ id: entregasDomiciliario.id });
      if (filas.length === 0) throw new EntregaInvalidaError("Esa entrega no está disponible.");
      // empresaId para que el vendedor vea el rastro en su auditoría. Sin
      // datos del comprador: solo el estado y, si aplica, el motivo.
      await registrarAuditoriaBodega(tx, {
        bodegaId,
        empresaId: propia.empresaId,
        usuarioId,
        accion: `entrega_${nuevo}`,
        entidad: "entrega_domiciliario",
        entidadId: entregaId,
        valorAnterior: propia.estado,
        valorNuevo: nuevo,
        detalle: nuevo === "no_entregada" ? `No entregada: ${motivoLimpio}` : undefined,
      });
    },
    "domiciliario",
    usuarioId
  );
}
