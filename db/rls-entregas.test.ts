import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoBodega } from "./bodega-context";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { auditoria, entregasDomiciliario, entregasDomiciliarioContacto, entregasNovedades, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import { aceptarInvitacionBodega, crearInvitacionBodega } from "../lib/bodega/invitaciones";
import { listarMiembros, cambiarActivoDeMiembro } from "../lib/bodega/miembros";
import { cambiarEstadoVinculo, crearBodega, invitarAdminBodega, ligarEmpresaABodega } from "../lib/superadmin-bodegas";
import { fotoDeNovedad, listarMisNovedades, listarNovedadesDeEntregas, reportarNovedad } from "../lib/entregas/novedades";
import { asignarEntrega, cambiarEstadoMiEntrega, EntregaInvalidaError, fotoDeEntrega, listarDomiciliariosAsignables, listarEntregasDePedidos, listarMisEntregas, miEntregaAbierta, quitarEntrega } from "../lib/entregas/entregas";

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
  // Domi-3: «entregada» exige foto. En la base solo se guarda el id privado de
  // Cloudinary; acá no se sube nada.
  const FOTO = `zilonix-entregas/prueba/${sufijo}`;

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
        tx.insert(entregasDomiciliario).values({ empresaId: empresaA, bodegaId: bodegaB, miembroDomiciliarioId: miembroB, pedidoReferencia: pedido("y") })
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
    const editadas = await dbComoEmpresa(empresaB, (tx) => tx.update(entregasDomiciliario).set({ motivo: "hack" }).returning({ id: entregasDomiciliario.id }));
    expect(editadas).toHaveLength(0);
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(entregasDomiciliarioContacto))).toHaveLength(0);
    const contactoEditado = await dbComoEmpresa(empresaB, (tx) => tx.update(entregasDomiciliarioContacto).set({ nota: "hack" }).returning({ id: entregasDomiciliarioContacto.entregaId }));
    expect(contactoEditado).toHaveLength(0);
    const borradas = await dbComoEmpresa(empresaB, (tx) => tx.delete(entregasDomiciliario).returning({ id: entregasDomiciliario.id }));
    expect(borradas).toHaveLength(0);
    // Y B no puede insertar una entrega a nombre de A.
    await expect(
      dbComoEmpresa(empresaB, (tx) => tx.insert(entregasDomiciliario).values({ empresaId: empresaA, bodegaId: bodegaA, miembroDomiciliarioId: miembro1, pedidoReferencia: pedido("z") }))
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
    const tocadas = await dbComoBodega(bodegaA, (tx) => tx.update(entregasDomiciliario).set({ motivo: "x" }).where(eq(entregasDomiciliario.pedidoReferencia, pedido("3"))).returning({ id: entregasDomiciliario.id }), "domiciliario", dom2);
    expect(tocadas).toHaveLength(0);
    // Sin usuario en la sesión, ni siquiera un domiciliario ve algo.
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliario), "domiciliario")).toHaveLength(0);
    // La bodega (admin) ve las de la suya; la otra bodega, ninguna.
    expect((await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliario), "admin_bodega", adminAId)).length).toBeGreaterThanOrEqual(2);
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(entregasDomiciliario), "admin_bodega", adminBId)).toHaveLength(0);
  });

  it("el domiciliario cierra su entrega, conserva la cabecera y deja de ver los datos del comprador; la empresa los conserva", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("4"), datos });
    const abierta = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("4"))!;
    expect(abierta.direccion).toBe(datos.direccion);
    expect(abierta.telefono).toBe(datos.telefono);

    await cambiarEstadoMiEntrega(bodegaA, dom1, abierta.id, "en_camino");
    const enCamino = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === abierta.id)!;
    expect(enCamino.estado).toBe("en_camino");
    expect(enCamino.direccion).toBe(datos.direccion);
    await cambiarEstadoMiEntrega(bodegaA, dom1, abierta.id, "entregada", undefined, FOTO);

    // La cabecera sigue (historial), los datos del comprador ya no.
    const cerrada = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === abierta.id)!;
    expect(cerrada.estado).toBe("entregada");
    expect(cerrada).toMatchObject({ receptorNombre: null, direccion: null, barrio: null, ciudad: null, telefono: null, nota: null });
    const directo = await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliarioContacto).where(eq(entregasDomiciliarioContacto.entregaId, abierta.id)), "domiciliario", dom1);
    expect(directo).toHaveLength(0);
    // Ya cerrada no se puede volver a tocar ni reasignar.
    await expect(cambiarEstadoMiEntrega(bodegaA, dom1, abierta.id, "no_entregada", "x")).rejects.toBeInstanceOf(EntregaInvalidaError);
    await expect(asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("4"), datos })).rejects.toBeInstanceOf(EntregaInvalidaError);
    // La empresa sigue viendo todos los datos.
    const [conservada] = await dbComoEmpresa(empresaA, (tx) =>
      tx.select().from(entregasDomiciliario).innerJoin(entregasDomiciliarioContacto, eq(entregasDomiciliarioContacto.entregaId, entregasDomiciliario.id)).where(eq(entregasDomiciliario.id, abierta.id))
    );
    expect(conservada.entregas_domiciliario.estado).toBe("entregada");
    expect(conservada.entregas_domiciliario_contacto).toMatchObject({ direccion: datos.direccion, telefono: datos.telefono, receptorNombre: datos.receptorNombre });
  });

  it("el domiciliario no puede escribir en el contacto, ni siquiera el de su entrega abierta", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("7"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("7"))!;
    const tocar = <T>(fn: (tx: typeof db) => Promise<T>) => dbComoBodega(bodegaA, fn, "domiciliario", dom1);
    // UPDATE y DELETE sin política para el domiciliario: RLS los filtra (0 filas).
    expect(await tocar((tx) => tx.update(entregasDomiciliarioContacto).set({ direccion: "otra" }).where(eq(entregasDomiciliarioContacto.entregaId, propia.id)).returning({ id: entregasDomiciliarioContacto.entregaId }))).toHaveLength(0);
    expect(await tocar((tx) => tx.delete(entregasDomiciliarioContacto).where(eq(entregasDomiciliarioContacto.entregaId, propia.id)).returning({ id: entregasDomiciliarioContacto.entregaId }))).toHaveLength(0);
    await expect(tocar((tx) => tx.insert(entregasDomiciliarioContacto).values({ entregaId: randomUUID(), empresaId: empresaA, ...datos }))).rejects.toThrow();
    const [intacto] = await dbComoEmpresa(empresaA, (tx) => tx.select().from(entregasDomiciliarioContacto).where(eq(entregasDomiciliarioContacto.entregaId, propia.id)));
    expect(intacto.direccion).toBe(datos.direccion);
  });

  it("un domiciliario no ve las entregas de otro de su bodega, y las propias cerradas quedan sin datos del comprador", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("5"), datos });
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("6"), datos });
    const todas = (tx: typeof db) => tx.select({ ref: entregasDomiciliario.pedidoReferencia, estado: entregasDomiciliario.estado }).from(entregasDomiciliario);
    const vistas1 = await dbComoBodega(bodegaA, todas, "domiciliario", dom1);
    expect(vistas1.map((e) => e.ref)).toContain(pedido("5"));
    expect(vistas1.map((e) => e.ref)).not.toContain(pedido("6"));
    const cerrada = (await listarMisEntregas(bodegaA, dom2)).find((e) => e.pedidoReferencia === pedido("6"))!;
    await cambiarEstadoMiEntrega(bodegaA, dom2, cerrada.id, "entregada", undefined, FOTO);
    expect((await dbComoBodega(bodegaA, todas, "domiciliario", dom1)).map((e) => e.ref)).not.toContain(pedido("6"));
    const propia = (await listarMisEntregas(bodegaA, dom2)).find((e) => e.id === cerrada.id)!;
    expect(propia.estado).toBe("entregada");
    expect(propia.direccion).toBeNull();
  });

  it("Domi-2: el domiciliario no cambia la entrega de otro, el motivo es obligatorio y cada cambio queda en auditoria con empresa_id", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("8"), datos });
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("9"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("8"))!;
    const ajena = (await listarMisEntregas(bodegaA, dom2)).find((e) => e.pedidoReferencia === pedido("9"))!;

    // UPDATE directo sobre la ajena: RLS filtra, 0 filas (no hay error).
    const filas = await dbComoBodega(bodegaA, (tx) => tx.update(entregasDomiciliario).set({ estado: "entregada" }).where(eq(entregasDomiciliario.id, ajena.id)).returning({ id: entregasDomiciliario.id }), "domiciliario", dom1);
    expect(filas).toHaveLength(0);
    // Y por la función: no la ve, falla sin cambiar nada.
    await expect(cambiarEstadoMiEntrega(bodegaA, dom1, ajena.id, "entregada", undefined, FOTO)).rejects.toBeInstanceOf(EntregaInvalidaError);
    expect((await listarMisEntregas(bodegaA, dom2)).find((e) => e.id === ajena.id)!.estado).toBe("asignada");

    // Sin motivo (o en blanco) no se guarda.
    await expect(cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "no_entregada")).rejects.toBeInstanceOf(EntregaInvalidaError);
    await expect(cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "no_entregada", "   ")).rejects.toBeInstanceOf(EntregaInvalidaError);
    expect((await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === propia.id)!.estado).toBe("asignada");

    await cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "en_camino");
    await cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "no_entregada", "No estaba");
    const cerrada = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === propia.id)!;
    expect(cerrada).toMatchObject({ estado: "no_entregada", motivo: "No estaba", direccion: null, telefono: null });

    // La empresa ve el rastro (empresa_id lleno) y el motivo, sin datos del comprador.
    const rastro = await dbComoEmpresa(empresaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, propia.id)));
    expect(rastro.map((a) => a.accion).sort()).toEqual(["entrega_en_camino", "entrega_no_entregada"]);
    expect(rastro.every((a) => a.empresaId === empresaA && a.bodegaId === bodegaA)).toBe(true);
    expect(rastro.find((a) => a.accion === "entrega_no_entregada")!.detalle).toContain("No estaba");
    expect(JSON.stringify(rastro)).not.toContain(datos.direccion);
    const [paraVendedor] = await listarEntregasDePedidos(empresaA, "mercadolibre", [pedido("8")]);
    expect(paraVendedor).toMatchObject({ estado: "no_entregada", motivo: "No estaba" });
  });

  it("Domi-3: «Entregado» exige foto en la lib y en la base, y la foto solo existe en una entregada", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("F1"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("F1"))!;

    // Sin foto, la lib no deja.
    await expect(cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "entregada")).rejects.toBeInstanceOf(EntregaInvalidaError);
    // Y aunque alguien se salte la lib, la base tampoco (política RESTRICTIVE).
    await expect(
      dbComoBodega(bodegaA, (tx) => tx.update(entregasDomiciliario).set({ estado: "entregada" }).where(eq(entregasDomiciliario.id, propia.id)), "domiciliario", dom1)
    ).rejects.toThrow();
    // Ni el domiciliario ni el vendedor pueden pegarle una foto a una entrega abierta (CHECK).
    await expect(
      dbComoBodega(bodegaA, (tx) => tx.update(entregasDomiciliario).set({ fotoPublicId: FOTO }).where(eq(entregasDomiciliario.id, propia.id)), "domiciliario", dom1)
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(empresaA, (tx) => tx.update(entregasDomiciliario).set({ fotoPublicId: FOTO }).where(eq(entregasDomiciliario.id, propia.id)))
    ).rejects.toThrow();
    // Nada de lo anterior cambió la entrega.
    expect((await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === propia.id)!.estado).toBe("asignada");
  });

  it("Domi-3: miEntregaAbierta solo responde por las propias y abiertas", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("F2"), datos });
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("F3"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("F2"))!;
    const ajena = (await listarMisEntregas(bodegaA, dom2)).find((e) => e.pedidoReferencia === pedido("F3"))!;
    await expect(miEntregaAbierta(bodegaA, dom1, propia.id)).resolves.toEqual({ empresaId: empresaA });
    await expect(miEntregaAbierta(bodegaA, dom1, ajena.id)).rejects.toBeInstanceOf(EntregaInvalidaError);
    await cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "entregada", undefined, FOTO);
    await expect(miEntregaAbierta(bodegaA, dom1, propia.id)).rejects.toBeInstanceOf(EntregaInvalidaError);
  });

  it("Domi-3: el vendedor ve que hay foto y su id; otra empresa no", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("F4"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("F4"))!;
    const [antes] = await listarEntregasDePedidos(empresaA, "mercadolibre", [pedido("F4")]);
    expect(antes.tieneFoto).toBe(false);
    await expect(fotoDeEntrega(empresaA, propia.id)).resolves.toBeNull();

    await cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "entregada", undefined, FOTO);
    const [despues] = await listarEntregasDePedidos(empresaA, "mercadolibre", [pedido("F4")]);
    expect(despues.tieneFoto).toBe(true);
    await expect(fotoDeEntrega(empresaA, propia.id)).resolves.toBe(FOTO);
    await expect(fotoDeEntrega(empresaB, propia.id)).resolves.toBeNull();
  });

  it("Domi-4: el domiciliario reporta novedades de SU entrega abierta; la empresa y su bodega las ven, otra empresa no", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("N1"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("N1"))!;
    const novedadId = randomUUID();
    await reportarNovedad(bodegaA, dom1, { novedadId, entregaId: propia.id, tipo: "voy_tarde", detalle: " 10 min ", fotoPublicId: FOTO });
    await reportarNovedad(bodegaA, dom1, { novedadId: randomUUID(), entregaId: propia.id, tipo: "otro", detalle: "La moto se varó" });

    const paraVendedor = await listarNovedadesDeEntregas(empresaA, [propia.id]);
    expect(paraVendedor.map((n) => [n.tipo, n.detalle, n.tieneFoto])).toEqual([["voy_tarde", "10 min", true], ["otro", "La moto se varó", false]]);
    await expect(listarNovedadesDeEntregas(empresaB, [propia.id])).resolves.toEqual([]);
    await expect(fotoDeNovedad(empresaA, novedadId)).resolves.toBe(FOTO);
    await expect(fotoDeNovedad(empresaB, novedadId)).resolves.toBeNull();
    // La entrega sigue abierta.
    expect((await listarMisEntregas(bodegaA, dom1)).find((e) => e.id === propia.id)!.estado).toBe("asignada");
    // El domiciliario las ve; otro domiciliario de la misma bodega no.
    expect((await listarMisNovedades(bodegaA, dom1)).filter((n) => n.entregaId === propia.id)).toHaveLength(2);
    expect((await listarMisNovedades(bodegaA, dom2)).filter((n) => n.entregaId === propia.id)).toHaveLength(0);
    // La bodega (admin) ve las de su bodega.
    const deBodega = await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasNovedades).where(eq(entregasNovedades.entregaId, propia.id)), "admin_bodega", adminAId);
    expect(deBodega).toHaveLength(2);
    // Queda en auditoría con la empresa.
    const rastro = await dbComoEmpresa(empresaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.entidadId, propia.id)));
    expect(rastro.filter((a) => a.accion === "entrega_novedad")).toHaveLength(2);
  });

  it("Domi-4: nadie reporta en la entrega de otro ni en una cerrada, nadie las edita ni las borra", async () => {
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro1, marketplace: "mercadolibre", pedidoReferencia: pedido("N2"), datos });
    await asignarEntrega(empresaA, usuarioA, { miembroId: miembro2, marketplace: "mercadolibre", pedidoReferencia: pedido("N3"), datos });
    const propia = (await listarMisEntregas(bodegaA, dom1)).find((e) => e.pedidoReferencia === pedido("N2"))!;
    const ajena = (await listarMisEntregas(bodegaA, dom2)).find((e) => e.pedidoReferencia === pedido("N3"))!;

    // Entrega de otro: ni por la lib ni con un INSERT directo.
    await expect(reportarNovedad(bodegaA, dom1, { novedadId: randomUUID(), entregaId: ajena.id, tipo: "voy_tarde", detalle: "" })).rejects.toBeInstanceOf(EntregaInvalidaError);
    await expect(
      dbComoBodega(bodegaA, (tx) => tx.insert(entregasNovedades).values({ entregaId: ajena.id, empresaId: empresaA, bodegaId: bodegaA, usuarioId: dom1, tipo: "voy_tarde" }), "domiciliario", dom1)
    ).rejects.toThrow();
    // A nombre de otro usuario, tampoco.
    await expect(
      dbComoBodega(bodegaA, (tx) => tx.insert(entregasNovedades).values({ entregaId: propia.id, empresaId: empresaA, bodegaId: bodegaA, usuarioId: dom2, tipo: "voy_tarde" }), "domiciliario", dom1)
    ).rejects.toThrow();
    // El vendedor no crea novedades.
    await expect(
      dbComoEmpresa(empresaA, (tx) => tx.insert(entregasNovedades).values({ entregaId: propia.id, empresaId: empresaA, bodegaId: bodegaA, usuarioId: usuarioA, tipo: "voy_tarde" }))
    ).rejects.toThrow();
    // «Otro» sin detalle: la lib y el CHECK de la base lo rechazan.
    await expect(reportarNovedad(bodegaA, dom1, { novedadId: randomUUID(), entregaId: propia.id, tipo: "otro", detalle: "  " })).rejects.toBeInstanceOf(EntregaInvalidaError);
    await expect(
      dbComoBodega(bodegaA, (tx) => tx.insert(entregasNovedades).values({ entregaId: propia.id, empresaId: empresaA, bodegaId: bodegaA, usuarioId: dom1, tipo: "otro" }), "domiciliario", dom1)
    ).rejects.toThrow();

    // Nadie edita ni borra.
    await reportarNovedad(bodegaA, dom1, { novedadId: randomUUID(), entregaId: propia.id, tipo: "no_contesta", detalle: "" });
    await expect(dbComoBodega(bodegaA, (tx) => tx.update(entregasNovedades).set({ detalle: "x" }).where(eq(entregasNovedades.entregaId, propia.id)), "domiciliario", dom1)).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.delete(entregasNovedades).where(eq(entregasNovedades.entregaId, propia.id)), "domiciliario", dom1)).rejects.toThrow();
    await expect(dbComoEmpresa(empresaA, (tx) => tx.delete(entregasNovedades).where(eq(entregasNovedades.entregaId, propia.id)))).rejects.toThrow();

    // Cerrada: no se reporta más y el domiciliario deja de verlas; la empresa las conserva.
    await cambiarEstadoMiEntrega(bodegaA, dom1, propia.id, "no_entregada", "No estaba");
    await expect(reportarNovedad(bodegaA, dom1, { novedadId: randomUUID(), entregaId: propia.id, tipo: "voy_tarde", detalle: "" })).rejects.toBeInstanceOf(EntregaInvalidaError);
    expect((await listarMisNovedades(bodegaA, dom1)).filter((n) => n.entregaId === propia.id)).toHaveLength(0);
    await expect(listarNovedadesDeEntregas(empresaA, [propia.id])).resolves.toHaveLength(1);
  });

  it("una sesión de bodega sin rol no ve ninguna entrega", async () => {
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliario))).toHaveLength(0);
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(entregasDomiciliario), undefined, adminAId)).toHaveLength(0);
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
