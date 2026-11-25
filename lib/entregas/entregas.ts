import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { dbComoEmpresa } from "@/db/empresa-context";
import { bodegas3pl, entregasDomiciliario, miembrosBodega3pl, usuarios } from "@/db/schema";
import { registrarAuditoria } from "@/lib/auditoria";
import { EntregaInvalidaError, validarDatosEntrega, type DatosEntrega } from "./validar";

export { EntregaInvalidaError };

// Issue #627 (Domi-1) — asignar una entrega a un domiciliario de la
// bodega 3PL ligada a la empresa. Todo corre con dbComoEmpresa: la RLS
// (db/rls-setup.sql) es quien impide elegir un domiciliario de otra
// bodega; los chequeos de acá solo dan un mensaje claro antes de llegar
// a un error de política.

export type EntradaAsignar = {
  pedidoRef: string;
  marketplace?: string;
  miembroDomiciliarioId: string;
  datos: DatosEntrega;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type DomiciliarioAsignable = { miembroId: string; nombre: string; bodegaId: string; bodegaNombre: string };

// Solo domiciliarios activos de bodegas ACTIVAS y ligadas (vínculo activo)
// a esta empresa: la política de miembros_bodega_3pl ya filtra el vínculo.
export async function listarDomiciliariosAsignables(empresaId: string): Promise<DomiciliarioAsignable[]> {
  return dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({ miembroId: miembrosBodega3pl.id, nombre: usuarios.nombre, bodegaId: bodegas3pl.id, bodegaNombre: bodegas3pl.nombre })
      .from(miembrosBodega3pl)
      .innerJoin(usuarios, eq(usuarios.id, miembrosBodega3pl.usuarioId))
      .innerJoin(bodegas3pl, eq(bodegas3pl.id, miembrosBodega3pl.bodegaId))
      .where(and(eq(miembrosBodega3pl.rol, "domiciliario"), eq(miembrosBodega3pl.activo, true), eq(bodegas3pl.estado, "activa")))
      .orderBy(asc(bodegas3pl.nombre), asc(usuarios.nombre))
  );
}

export type EntregaAbiertaDePedido = { entregaId: string; miembroDomiciliarioId: string; domiciliarioNombre: string; estado: "asignada" | "en_camino" };

// Para pintar el botón de cada tarjeta: qué pedidos ya tienen entrega abierta.
export async function listarEntregasAbiertasPorPedido(empresaId: string, marketplace: string, pedidoRefs: string[]): Promise<Map<string, EntregaAbiertaDePedido>> {
  const mapa = new Map<string, EntregaAbiertaDePedido>();
  if (pedidoRefs.length === 0) return mapa;
  const filas = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .select({
        pedidoRef: entregasDomiciliario.pedidoRef,
        entregaId: entregasDomiciliario.id,
        miembroDomiciliarioId: entregasDomiciliario.miembroDomiciliarioId,
        domiciliarioNombre: usuarios.nombre,
        estado: entregasDomiciliario.estado,
      })
      .from(entregasDomiciliario)
      .innerJoin(miembrosBodega3pl, eq(miembrosBodega3pl.id, entregasDomiciliario.miembroDomiciliarioId))
      .innerJoin(usuarios, eq(usuarios.id, miembrosBodega3pl.usuarioId))
      .where(
        and(
          eq(entregasDomiciliario.empresaId, empresaId),
          eq(entregasDomiciliario.marketplace, marketplace),
          inArray(entregasDomiciliario.pedidoRef, pedidoRefs),
          inArray(entregasDomiciliario.estado, ["asignada", "en_camino"])
        )
      )
  );
  for (const f of filas) {
    mapa.set(f.pedidoRef, { entregaId: f.entregaId, miembroDomiciliarioId: f.miembroDomiciliarioId, domiciliarioNombre: f.domiciliarioNombre, estado: f.estado as "asignada" | "en_camino" });
  }
  return mapa;
}

// Asigna o reasigna. Los datos del comprador se copian AHORA (no se piden
// a Mercado Libre) y quedan en la fila; la auditoría solo dice quién y
// cuál pedido, nunca dirección ni teléfono.
export async function asignarEntrega(empresaId: string, usuarioId: string, entrada: EntradaAsignar): Promise<{ entregaId: string; reasignada: boolean }> {
  const marketplace = (entrada.marketplace ?? "mercadolibre").trim();
  const pedidoRef = entrada.pedidoRef.trim();
  if (!pedidoRef) throw new EntregaInvalidaError("Falta el pedido.");
  if (!UUID_RE.test(entrada.miembroDomiciliarioId)) throw new EntregaInvalidaError("Elige un domiciliario.");
  const datos = validarDatosEntrega(entrada.datos);

  return dbComoEmpresa(empresaId, async (tx) => {
    // Visible solo si es domiciliario activo de una bodega ligada y activa.
    const [miembro] = await tx
      .select({ bodegaId: miembrosBodega3pl.bodegaId, nombre: usuarios.nombre, estadoBodega: bodegas3pl.estado })
      .from(miembrosBodega3pl)
      .innerJoin(usuarios, eq(usuarios.id, miembrosBodega3pl.usuarioId))
      .innerJoin(bodegas3pl, eq(bodegas3pl.id, miembrosBodega3pl.bodegaId))
      .where(and(eq(miembrosBodega3pl.id, entrada.miembroDomiciliarioId), eq(miembrosBodega3pl.rol, "domiciliario"), eq(miembrosBodega3pl.activo, true)));
    if (!miembro || miembro.estadoBodega !== "activa") throw new EntregaInvalidaError("Ese domiciliario no está disponible para tu empresa.");

    const [abierta] = await tx
      .select({ id: entregasDomiciliario.id, miembroDomiciliarioId: entregasDomiciliario.miembroDomiciliarioId })
      .from(entregasDomiciliario)
      .where(
        and(
          eq(entregasDomiciliario.empresaId, empresaId),
          eq(entregasDomiciliario.marketplace, marketplace),
          eq(entregasDomiciliario.pedidoRef, pedidoRef),
          inArray(entregasDomiciliario.estado, ["asignada", "en_camino"])
        )
      );

    if (abierta) {
      const actualizadas = await tx
        .update(entregasDomiciliario)
        .set({ bodegaId: miembro.bodegaId, miembroDomiciliarioId: entrada.miembroDomiciliarioId, ...datos, barrio: datos.barrio || null, nota: datos.nota || null, actualizadaTs: sql`now()` })
        .where(and(eq(entregasDomiciliario.id, abierta.id), eq(entregasDomiciliario.empresaId, empresaId)))
        .returning({ id: entregasDomiciliario.id });
      if (actualizadas.length === 0) throw new EntregaInvalidaError("No se pudo reasignar: la entrega ya no está abierta.");
      await registrarAuditoria(tx, {
        empresaId, usuarioId, actorTipo: "persona", accion: "reasignar_entrega", entidad: "entrega_domiciliario", entidadId: abierta.id,
        valorAnterior: abierta.miembroDomiciliarioId, valorNuevo: entrada.miembroDomiciliarioId,
        detalle: `Reasignó la entrega del pedido ${pedidoRef} a ${miembro.nombre}.`,
      });
      return { entregaId: abierta.id, reasignada: true };
    }

    const [nueva] = await tx
      .insert(entregasDomiciliario)
      .values({ empresaId, bodegaId: miembro.bodegaId, miembroDomiciliarioId: entrada.miembroDomiciliarioId, pedidoRef, marketplace, ...datos, barrio: datos.barrio || null, nota: datos.nota || null })
      .returning({ id: entregasDomiciliario.id });
    await registrarAuditoria(tx, {
      empresaId, usuarioId, actorTipo: "persona", accion: "asignar_entrega", entidad: "entrega_domiciliario", entidadId: nueva.id,
      valorNuevo: entrada.miembroDomiciliarioId, detalle: `Asignó el pedido ${pedidoRef} a ${miembro.nombre}.`,
    });
    return { entregaId: nueva.id, reasignada: false };
  });
}

// Quitar solo se puede mientras la entrega siga «asignada» (la política de
// DELETE lo exige); en camino o cerrada ya no se borra.
export async function quitarEntrega(empresaId: string, usuarioId: string, entregaId: string): Promise<void> {
  if (!UUID_RE.test(entregaId)) throw new EntregaInvalidaError("La entrega no existe.");
  await dbComoEmpresa(empresaId, async (tx) => {
    const borradas = await tx
      .delete(entregasDomiciliario)
      .where(and(eq(entregasDomiciliario.id, entregaId), eq(entregasDomiciliario.empresaId, empresaId), eq(entregasDomiciliario.estado, "asignada")))
      .returning({ id: entregasDomiciliario.id, pedidoRef: entregasDomiciliario.pedidoRef, miembroDomiciliarioId: entregasDomiciliario.miembroDomiciliarioId });
    if (borradas.length === 0) throw new EntregaInvalidaError("Solo se puede quitar una entrega que todavía no salió.");
    await registrarAuditoria(tx, {
      empresaId, usuarioId, actorTipo: "persona", accion: "quitar_entrega", entidad: "entrega_domiciliario", entidadId: entregaId,
      valorAnterior: borradas[0].miembroDomiciliarioId, detalle: `Quitó la asignación del pedido ${borradas[0].pedidoRef}.`,
    });
  });
}
