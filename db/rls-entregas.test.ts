import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoBodega } from "./bodega-context";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { auditoria, entregasDomiciliario, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import { aceptarInvitacionBodega, crearInvitacionBodega } from "../lib/bodega/invitaciones";
import { listarMiembros, cambiarActivoDeMiembro } from "../lib/bodega/miembros";
import { cambiarEstadoVinculo, crearBodega, invitarAdminBodega, ligarEmpresaABodega } from "../lib/superadmin-bodegas";
import { asignarEntrega, cambiarEstadoMiEntrega, EntregaInvalidaError, listarDomiciliariosAsignables, listarMisEntregas, quitarEntrega } from "../lib/entregas/entregas";

// Issue #627 (Domi-1) — contra Postgres real. Pruebas A/B propias (no
// afirmarAislamiento: app_user no tiene todos los UPDATE/DELETE). Un UPDATE
// filtrado por RLS no falla: afecta 0 filas, por eso .returning() + longitud 0.
describe("entregas_domiciliario (RLS + lib, Domi-1)", () => {
  const superadminId = randomUUID();
  const adminAId = randomUUID();
  const adminBId = randomUUID();
  const dom1 = randomUUID();
  const dom2 = randomUUID();
  const domB = randomUUID();
  let empresaA: string;
  let empresaB: string;
  let usuarioA: string;
  let bodegaA: string;
  let bodegaB: string;
  let miembro1: string;
  let miembro2: string;
  let miembroB: string;
  const sufijo = randomUUID().slice(0, 8);

  const datos = { receptorNombre: "Ana Prueba", direccion: "Calle 1 # 2-3", barrio: "Centro", ciudad: "Medellín", telefono: "3001234567", nota: "Timbre" };
  const pedido = (n: string) => `P-${sufijo}-${n}`;

  async function usuario(id: string, extra: Partial<typeof usuarios.$inferInsert> = {}) {
    await db.insert(usuarios).values({ id, email: `entregas-${id.slice(0, 8)}@zilonix.test`, nombre: `Persona ${id.slice(0, 4)}`, ...extra });
  }
  async function conDomiciliario(bodegaId: string, adminId: string, domId: string) {
    const inv = await crearInvitacionBodega({ bodegaId, bodegaNombre: "B", email: `d-${domId.slice(0, 6)}@zilonix.test`, rol: "domiciliario", invitadoPor: adminId });
    await aceptarInvitacionBodega(inv.token, domId);
    return (await listarMiembros(bodegaId)).find((m) => m.usuarioId === domId)!.miembroId;
  }

  beforeAll(async () => {
    await usuario(superadminId, { esSuperadmin: true });
    for (const id of [adminAId, adminBId, dom1, dom2, domB]) await usuario(id);
    const ctx = await crearDosEmpresas();
    empresaA = ctx.empresaAId;
    empresaB = ctx.empresaBId;
    usuarioA = ctx.usuarioAId;
    bodegaA = (await crearBodega(superadminId, { nombre: `Bodega A ${sufijo}`, nit: "" })).id;
    bodegaB = (await crearBodega(superadminId, { nombre: `Bodega B ${sufijo}`, nit: "" })).id;
    await aceptarInvitacionBodega((await invitarAdminBodega(superadminId, bodegaA, "a@zilonix.test")).token, adminAId);
    await aceptarInvitacionBodega((await invitarAdminBodega(superadminId, bodegaB, "b@zilonix.test")).token, adminBId);
    miembro1 = await conDomiciliario(bodegaA, adminAId, dom1);
    miembro2 = await conDomiciliario(bodegaA, adminAId, dom2);
    miembroB = await conDomiciliario(bodegaB, adminBId, domB);
    await ligarEmpresaABodega(superadminId, bodegaA, empresaA);
  });

  it("el vendedor solo puede elegir domiciliarios de su bodega ligada y activa", async () => {
    const ids = (await listarDomiciliariosAsignables(empresaA)).map((d) => d.miembroId);
    expect(ids).toContain(miembro1);
    expect(ids).not.toContain(miembroB);
    expect(await listarDomiciliariosAsignables(empresaB)).toHaveLength(0);
    // Con la bodega B sin ligar a A, asignarle falla por RLS/validación.
    await expect(asignarEntrega(empresaA, usuarioA, { miembroId: miembroB, marketplace: "mercadolibre", pedidoReferencia: pedido("x"), datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    // Aun saltándose la lib, el WITH CHECK de la base lo rechaza.
    await expect(
      dbComoEmpresa(empresaA, (tx) =>
        tx.insert(entregasDomiciliario).values({ empresaId: empresaA, bodegaId: bodegaB, miembroDomiciliarioId: miembroB, pedidoReferencia: pedido("y"), ...datos })
      )
    ).rejects.toThrow();
  });

  it("asigna, reasigna, y deja todo en auditoria con empresa_id", async () => {
    expect(await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("1"), datos })).toEqual({ accion: "asignada" });
    expect(await asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("1"), datos })).toEqual({ accion: "reasignada" });
    const filas = await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliario).where(eq(entregasDomiciliario.pedidoReferencia, pedido("1"))));
    expect(filas).toHaveLength(1);
    expect(filas[0].miembroDomiciliarioId).toBe(miembro2);

    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("2"), datos });
    await quitarEntrega(empresaA, usuarioA, "mercadolibre", pedido("2"));
    await expect(quitarEntrega(empresaA, usuarioA, "mercadolibre", pedido("2"))).rejects.toBeInstanceOf(EntregaInvalidaError);

    const acciones = (await dbComoEmpresa(empresaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.empresaId, empresaA)))).map((a) => a.accion);
    for (const a of ["asignar_domiciliario", "reasignar_domiciliario", "quitar_domiciliario"]) expect(acciones).toContain(a);
  });

  it("otra empresa no ve, edita ni borra las entregas", async () => {
    const vistas = await dbComoEmpresa(empresaB, (tx) => tx.select().from(entregasDomiciliario));
    expect(vistas).toHaveLength(0);
    const editadas = await dbComoEmpresa(empresaB, (tx) => tx.update(entregasDomiciliario).set({ nota: "hack" }).returning({ id: entregasDomiciliario.id }));
    expect(editadas).toHaveLength(0);
    const borradas = await dbComoEmpresa(empresaB, (tx) => tx.delete(entregasDomiciliario).returning({ id: entregasDomiciliario.id }));
    expect(borradas).toHaveLength(0);
    // Y B no puede insertar una entrega a nombre de A.
    await expect(
      dbComoEmpresa(empresaB, (tx) => tx.insert(entregasDomiciliario).values({ empresaId: empresaA, bodegaId: bodegaA, miembroDomiciliarioId: miembro1, pedidoReferencia: pedido("z"), ...datos }))
    ).rejects.toThrow();
  });

  it("un domiciliario no ve las entregas de otro; la bodega ve las de su bodega y no las de otra", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("3"), datos });
    const deDom1 = await listarMisEntregas(bodegaA, dom1);
    expect(deDom1.map((e) => e.pedidoReferencia)).toEqual([pedido("3")]);
    const deDom2 = await listarMisEntregas(bodegaA, dom2);
    expect(deDom2.map((e) => e.pedidoReferencia)).toEqual([pedido("1")]);
    expect(await listarMisEntregas(bodegaB, domB)).toHaveLength(0);
    // dom2 no puede tomar la de dom1 ni usando la bodega correcta.
    const tocadas = await dbComoBodega(bodegaA, (tx) => tx.update(entregasDomiciliario).set({ nota: "x" }).where(eq(entregasDomiciliario.pedidoReferencia, pedido("3"))).returning({ id: entregasDomiciliario.id }), "domiciliario", dom2);
    expect(tocadas).toHaveLength(0);
    // Sin usuario en la sesión, ni siquiera un domiciliario ve algo.
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliario), "domiciliario")).toHaveLength(0);
    // La bodega (admin) ve las de la suya; la otra bodega, ninguna.
    expect((await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliario), "admin_bodega", adminAId)).length).toBeGreaterThanOrEqual(2);
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(entregasDomiciliario), "admin_bodega", adminBId)).toHaveLength(0);
  });

  it("el domiciliario no ve los datos del comprador cuando la entrega está cerrada; la empresa los conserva", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("4"), datos });
    const abierta = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("4"))!;
    expect(abierta.direccion).toBe(datos.direccion);

    await cambiarEstadoMiEntrega(bodegaA, dom1, abierta.id, "en_camino");
    expect((await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === abierta.id)?.estado).toBe("en_camino");
    await cambiarEstadoMiEntrega(bodegaA, dom1, abierta.id, "entregada");

    expect((await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === abierta.id)).toBeUndefined();
    const directo = await dbComoBodega(bodegaA, (tx) => tx.select({ direccion: entregasDomiciliario.direccion, telefono: entregasDomiciliario.telefono }).from(entregasDomiciliario).where(eq(entregasDomiciliario.id, abierta.id)), "domiciliario", dom1);
    expect(directo).toHaveLength(0);
    // Ya cerrada no se puede volver a tocar ni reasignar.
    await expect(cambiarEstadoMiEntrega(bodegaA, dom1, abierta.id, "no_entregada", "x")).rejects.toBeInstanceOf(EntregaInvalidaError);
    await expect(asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("4"), datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    // La empresa sigue viendo todos los datos.
    const [conservada] = await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliario).where(eq(entregasDomiciliario.id, abierta.id)));
    expect(conservada).toMatchObject({ estado: "entregada", direccion: datos.direccion, telefono: datos.telefono, receptorNombre: datos.receptorNombre });
  });

  it("no se puede asignar a un domiciliario desactivado ni con el vínculo pausado", async () => {
    await cambiarActivoDeMiembro(bodegaA, adminAId, miembro2, false, "admin_bodega");
    await expect(asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("5"), datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    // Un domiciliario desactivado deja de ver sus entregas.
    expect(await listarMisEntregas(bodegaA, dom2)).toHaveLength(0);
    await cambiarActivoDeMiembro(bodegaA, adminAId, miembro2, true, "admin_bodega");

    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "pausada");
    expect(await listarDomiciliariosAsignables(empresaA)).toHaveLength(0);
    await expect(asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("6"), datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "activa");
  });
});
