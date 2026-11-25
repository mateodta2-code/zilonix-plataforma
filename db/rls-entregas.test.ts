import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbComoBodega } from "./bodega-context";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { auditoria, entregasDomiciliario, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import { aceptarInvitacionBodega, crearInvitacionBodega } from "../lib/bodega/invitaciones";
import { listarMiembros } from "../lib/bodega/miembros";
import { cambiarEstadoVinculo, crearBodega, ligarEmpresaABodega, suspenderBodega, reactivarBodega } from "../lib/superadmin-bodegas";
import { asignarEntrega, EntregaInvalidaError, listarDomiciliariosAsignables, quitarEntrega } from "../lib/entregas/entregas";

// Issue #627 (Domi-1, migración 0045) — contra Postgres real. No usa
// afirmarAislamiento: app_user no tiene UPDATE de todas las columnas ni
// DELETE sobre cualquier estado, así que cada comprobación A/B es propia.
const datos = { receptorNombre: "Ana Pérez", direccion: "Calle 1 # 2-3", barrio: "Centro", ciudad: "Cali", telefono: "3000000000", nota: "Timbre roto" };

describe("entregas_domiciliario (RLS, Domi-1)", () => {
  const sufijo = randomUUID().slice(0, 8);
  const superadminId = randomUUID();
  const adminId = randomUUID();
  const operarioId = randomUUID();
  const dom1Id = randomUUID();
  const dom2Id = randomUUID();
  const domBId = randomUUID();
  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let bodega1: string;
  let bodega2: string;
  let miembroDom1: string;
  let miembroDom2: string;
  let miembroDomB2: string;
  const admin = postgres(process.env.DATABASE_URL ?? "postgresql://sin-url", { max: 1 });

  async function usuario(id: string, extra: Partial<typeof usuarios.$inferInsert> = {}) {
    await db.insert(usuarios).values({ id, email: `entrega-${id.slice(0, 8)}@zilonix.test`, nombre: `Persona ${id.slice(0, 4)}`, ...extra });
  }
  async function unirse(bodegaId: string, usuarioId: string, rol: string) {
    const { token } = await crearInvitacionBodega({ bodegaId, bodegaNombre: "x", email: `i-${usuarioId.slice(0, 6)}@zilonix.test`, rol, invitadoPor: adminId });
    await aceptarInvitacionBodega(token, usuarioId);
    return (await listarMiembros(bodegaId)).find((m) => m.usuarioId === usuarioId)!.miembroId;
  }
  const comoDom = (bodega: string, miembro: string) => dbComoBodega(bodega, (tx) => tx.select().from(entregasDomiciliario), "domiciliario", miembro);

  beforeAll(async () => {
    await usuario(superadminId, { esSuperadmin: true });
    for (const id of [adminId, operarioId, dom1Id, dom2Id, domBId]) await usuario(id);
    const ctx = await crearDosEmpresas();
    empresaA = ctx.empresaAId;
    empresaB = ctx.empresaBId;
    usuarioA = ctx.usuarioAId;
    bodega1 = (await crearBodega(superadminId, { nombre: `Bodega 1 ${sufijo}`, nit: "" })).id;
    bodega2 = (await crearBodega(superadminId, { nombre: `Bodega 2 ${sufijo}`, nit: "" })).id;
    miembroDom1 = await unirse(bodega1, dom1Id, "domiciliario");
    miembroDom2 = await unirse(bodega1, dom2Id, "domiciliario");
    await unirse(bodega1, operarioId, "operario");
    miembroDomB2 = await unirse(bodega2, domBId, "domiciliario");
    await ligarEmpresaABodega(superadminId, bodega1, empresaA);
  });

  afterAll(async () => {
    await admin.end();
  });

  it("el vendedor solo lista domiciliarios de su bodega ligada", async () => {
    const lista = (await listarDomiciliariosAsignables(empresaA)).map((d) => d.miembroId);
    expect(lista).toEqual(expect.arrayContaining([miembroDom1, miembroDom2]));
    expect(lista).not.toContain(miembroDomB2);
    expect(await listarDomiciliariosAsignables(empresaB)).toHaveLength(0);
  });

  it("asigna, y no puede elegir un domiciliario de otra bodega (lib y WITH CHECK)", async () => {
    const r = await asignarEntrega(empresaA, usuarioA, { pedidoRef: `P-${sufijo}-1`, miembroDomiciliarioId: miembroDom1, datos });
    expect(r.reasignada).toBe(false);
    await expect(asignarEntrega(empresaA, usuarioA, { pedidoRef: `P-${sufijo}-x`, miembroDomiciliarioId: miembroDomB2, datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    // Saltándose la lib, la política igual lo rechaza.
    await expect(
      dbComoEmpresa(empresaA, (tx) => tx.insert(entregasDomiciliario).values({ empresaId: empresaA, bodegaId: bodega2, miembroDomiciliarioId: miembroDomB2, pedidoRef: `P-${sufijo}-y`, ...datos }))
    ).rejects.toThrow();
    // Ni a nombre de otra empresa.
    await expect(
      dbComoEmpresa(empresaB, (tx) => tx.insert(entregasDomiciliario).values({ empresaId: empresaB, bodegaId: bodega1, miembroDomiciliarioId: miembroDom1, pedidoRef: `P-${sufijo}-z`, ...datos }))
    ).rejects.toThrow();
  });

  it("reasignar cambia de domiciliario sin duplicar la entrega abierta y queda en auditoría", async () => {
    const ref = `P-${sufijo}-1`;
    const r = await asignarEntrega(empresaA, usuarioA, { pedidoRef: ref, miembroDomiciliarioId: miembroDom2, datos });
    expect(r.reasignada).toBe(true);
    const filas = await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliario).where(eq(entregasDomiciliario.pedidoRef, ref)));
    expect(filas).toHaveLength(1);
    expect(filas[0].miembroDomiciliarioId).toBe(miembroDom2);
    const acciones = (await dbComoEmpresa(empresaA, (tx) => tx.select().from(auditoria).where(and(eq(auditoria.empresaId, empresaA), eq(auditoria.entidad, "entrega_domiciliario"))))).map((a) => a.accion);
    expect(acciones).toEqual(expect.arrayContaining(["asignar_entrega", "reasignar_entrega"]));
  });

  it("quitar solo funciona mientras está asignada y queda en auditoría", async () => {
    const ref = `P-${sufijo}-q`;
    const { entregaId } = await asignarEntrega(empresaA, usuarioA, { pedidoRef: ref, miembroDomiciliarioId: miembroDom1, datos });
    await quitarEntrega(empresaA, usuarioA, entregaId);
    expect(await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliario).where(eq(entregasDomiciliario.pedidoRef, ref)))).toHaveLength(0);
    await expect(quitarEntrega(empresaA, usuarioA, entregaId)).rejects.toBeInstanceOf(EntregaInvalidaError);
    const acciones = (await dbComoEmpresa(empresaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, entregaId)))).map((a) => a.accion);
    expect(acciones).toEqual(expect.arrayContaining(["asignar_entrega", "quitar_entrega"]));
  });

  it("otra empresa no ve, no actualiza y no borra las entregas (A/B)", async () => {
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(entregasDomiciliario))).toHaveLength(0);
    const upd = await dbComoEmpresa(empresaB, (tx) => tx.update(entregasDomiciliario).set({ direccion: "hackeada" }).where(eq(entregasDomiciliario.empresaId, empresaA)).returning({ id: entregasDomiciliario.id }));
    expect(upd).toHaveLength(0);
    const del = await dbComoEmpresa(empresaB, (tx) => tx.delete(entregasDomiciliario).where(eq(entregasDomiciliario.empresaId, empresaA)).returning({ id: entregasDomiciliario.id }));
    expect(del).toHaveLength(0);
    expect((await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliario))).length).toBeGreaterThan(0);
  });

  it("el domiciliario ve solo las suyas; la bodega, las de su bodega; otra bodega, ninguna", async () => {
    expect(await comoDom(bodega1, miembroDom1)).toHaveLength(0);
    const suyas = await comoDom(bodega1, miembroDom2);
    expect(suyas).toHaveLength(1);
    expect(suyas[0].miembroDomiciliarioId).toBe(miembroDom2);
    // Sin miembro o sin rol declarado no hay filas, aunque lleve app.bodega_id.
    expect(await dbComoBodega(bodega1, (tx) => tx.select().from(entregasDomiciliario), "domiciliario")).toHaveLength(0);
    expect(await dbComoBodega(bodega1, (tx) => tx.select().from(entregasDomiciliario))).toHaveLength(0);
    // La bodega (operario) ve todas las suyas; la bodega 2 ninguna.
    const bodega = await dbComoBodega(bodega1, (tx) => tx.select().from(entregasDomiciliario), "operario");
    expect(bodega.length).toBeGreaterThan(0);
    expect(await dbComoBodega(bodega2, (tx) => tx.select().from(entregasDomiciliario), "operario")).toHaveLength(0);
    expect(await comoDom(bodega2, miembroDomB2)).toHaveLength(0);
    // Y no puede escribir nada (sin política de INSERT/UPDATE/DELETE para la bodega).
    const upd = await dbComoBodega(bodega1, (tx) => tx.update(entregasDomiciliario).set({ direccion: "x" }).returning({ id: entregasDomiciliario.id }), "operario");
    expect(upd).toHaveLength(0);
  });

  it.skipIf(!process.env.DATABASE_URL)("al cerrarse la entrega, el domiciliario ya no ve los datos del comprador y la empresa los conserva", async () => {
    const ref = `P-${sufijo}-1`;
    expect((await comoDom(bodega1, miembroDom2)).map((e) => e.direccion)).toContain(datos.direccion);
    // Lo que hará Domi-2 al marcar entregada: aquí con el usuario de migración.
    await admin`UPDATE entregas_domiciliario SET estado = 'entregada' WHERE pedido_ref = ${ref} AND empresa_id = ${empresaA}`;
    expect(await comoDom(bodega1, miembroDom2)).toHaveLength(0);
    const empresa = await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliario).where(eq(entregasDomiciliario.pedidoRef, ref)));
    expect(empresa[0]).toMatchObject({ estado: "entregada", direccion: datos.direccion, telefono: datos.telefono, receptorNombre: datos.receptorNombre });
    // Ya cerrada, la empresa no la reasigna ni la borra.
    const upd = await dbComoEmpresa(empresaA, (tx) => tx.update(entregasDomiciliario).set({ miembroDomiciliarioId: miembroDom1 }).where(eq(entregasDomiciliario.pedidoRef, ref)).returning({ id: entregasDomiciliario.id }));
    expect(upd).toHaveLength(0);
  });

  it("un domiciliario desactivado deja de ser asignable y de ver sus entregas", async () => {
    const ref = `P-${sufijo}-d`;
    await asignarEntrega(empresaA, usuarioA, { pedidoRef: ref, miembroDomiciliarioId: miembroDom1, datos });
    expect(await comoDom(bodega1, miembroDom1)).toHaveLength(1);
    await admin`UPDATE miembros_bodega_3pl SET activo = false WHERE id = ${miembroDom1}`;
    expect(await comoDom(bodega1, miembroDom1)).toHaveLength(0);
    await expect(asignarEntrega(empresaA, usuarioA, { pedidoRef: `P-${sufijo}-e`, miembroDomiciliarioId: miembroDom1, datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    await admin`UPDATE miembros_bodega_3pl SET activo = true WHERE id = ${miembroDom1}`;
  }, 30000);

  it("vínculo pausado o bodega suspendida: no se puede asignar", async () => {
    await cambiarEstadoVinculo(superadminId, bodega1, empresaA, "pausada");
    await expect(asignarEntrega(empresaA, usuarioA, { pedidoRef: `P-${sufijo}-p`, miembroDomiciliarioId: miembroDom2, datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    await cambiarEstadoVinculo(superadminId, bodega1, empresaA, "activa");
    await suspenderBodega(superadminId, bodega1, "Prueba");
    await expect(asignarEntrega(empresaA, usuarioA, { pedidoRef: `P-${sufijo}-s`, miembroDomiciliarioId: miembroDom2, datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    await reactivarBodega(superadminId, bodega1);
  });
});
