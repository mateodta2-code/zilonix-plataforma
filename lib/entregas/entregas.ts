import { randomUUID } from "crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { dbComoBodega } from "@/db/bodega-context";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas3pl, entregasDomiciliario, miembrosBodega3pl, usuarios } from "@/db/schema";
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

export type EntregaDePedido = { id: string; pedidoReferencia: string; estado: string; miembroDomiciliarioId: string; domiciliarioNombre: string } & DatosEntrega;

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
        miembroDomiciliarioId: entregasDomiciliario.miembroDomiciliarioId,
        domiciliarioNombre: usuarios.nombre,
        receptorNombre: entregasDomiciliario.receptorNombre,
        direccion: entregasDomiciliario.direccion,
        barrio: entregasDomiciliario.barrio,
        ciudad: entregasDomiciliario.ciudad,
        telefono: entregasDomiciliario.telefono,
        nota: entregasDomiciliario.nota,
      })
      .from(entregasDomiciliario)
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
    if (actual) {
      accion = "reasignada";
      if (actual.bodegaId !== miembro.bodegaId) {
        // bodega_id no se edita: cambiar de bodega es quitar y volver a crear.
        await tx.delete(entregasDomiciliario).where(eq(entregasDomiciliario.id, actual.id));
      } else {
        const filas = await tx
          .update(entregasDomiciliario)
          .set({ miembroDomiciliarioId: miembro.id, ...datos, actualizadaTs: new Date() })
          .where(eq(entregasDomiciliario.id, actual.id))
          .returning({ id: entregasDomiciliario.id });
        if (filas.length === 0) throw new EntregaInvalidaError("No se pudo reasignar la entrega.");
      }
    }
    if (!actual || actual.bodegaId !== miembro.bodegaId) {
      await tx.insert(entregasDomiciliario).values({
        id: randomUUID(),
        empresaId,
        bodegaId: miembro.bodegaId,
        miembroDomiciliarioId: miembro.id,
        marketplace: entrada.marketplace,
        pedidoReferencia: referencia,
        ...datos,
      });
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

// ── Para Domi-2 (#629), desde /domiciliario con accesoBodega("domiciliario") ──
// La base (política entrega_domiciliario_ver) ya devuelve solo las filas
// ABIERTAS y SUYAS: no hay filtro de estado que olvidar acá.
export async function listarMisEntregas(bodegaId: string, usuarioId: string) {
  return dbComoBodega(
    bodegaId,
    (tx) => tx.select().from(entregasDomiciliario).orderBy(asc(entregasDomiciliario.asignadaTs)),
    "domiciliario",
    usuarioId
  );
}

export type EstadoNuevoEntrega = "en_camino" | "entregada" | "no_entregada";

export async function cambiarEstadoMiEntrega(bodegaId: string, usuarioId: string, entregaId: string, nuevo: EstadoNuevoEntrega, motivo?: string): Promise<void> {
  const motivoLimpio = motivo?.trim() || null;
  if (nuevo === "no_entregada" && !motivoLimpio) throw new EntregaInvalidaError("Indica el motivo de la no entrega.");
  await dbComoBodega(
    bodegaId,
    async (tx) => {
      // Se lee antes (la política solo deja ver las abiertas y suyas) y el
      // UPDATE va sin RETURNING: la fila ya cerrada no pasa la política de
      // SELECT del domiciliario, y es lo esperado (no ve sus datos).
      const [propia] = await tx.select({ id: entregasDomiciliario.id }).from(entregasDomiciliario).where(eq(entregasDomiciliario.id, entregaId));
      if (!propia) throw new EntregaInvalidaError("Esa entrega no está disponible.");
      await tx.update(entregasDomiciliario).set({ estado: nuevo, motivo: motivoLimpio, actualizadaTs: new Date() }).where(eq(entregasDomiciliario.id, entregaId));
      await registrarAuditoriaBodega(tx, { bodegaId, usuarioId, accion: `entrega_${nuevo}`, entidad: "entrega_domiciliario", entidadId: entregaId });
    },
    "domiciliario",
    usuarioId
  );
}
