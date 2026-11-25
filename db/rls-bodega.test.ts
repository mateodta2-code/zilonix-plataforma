import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoBodega, dbComoInvitacionBodega, dbComoUsuarioBodega } from "./bodega-context";
import { dbComoEmpresa, dbComoUsuario } from "./empresa-context";
import { db } from "./index";
import { dbSuperadmin } from "./superadmin-context";
import { auditoria, bodegas3pl, bodegas3plEmpresas, empresas, invitacionesBodega3pl, miembrosBodega3pl, recepcionesBodega3pl, recepcionItemsBodega3pl, stockBodega3pl, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";
import { aceptarInvitacionBodega, crearInvitacionBodega, InvitacionBodegaInvalidaError, obtenerInvitacionBodegaPorToken } from "../lib/bodega/invitaciones";
import { CambioBodegaInvalidoError, actualizarDatosBodega, cambiarActivoDeMiembro, cambiarRolDeMiembro, listarMembresiasDeUsuario, listarMiembros } from "../lib/bodega/miembros";
import { BodegaInvalidaError, cambiarEstadoVinculo, crearBodega, invitarAdminBodega, ligarEmpresaABodega, listarBodegas, reactivarBodega, suspenderBodega } from "../lib/superadmin-bodegas";
import { listarBodegasQueAtiendenEmpresa, listarEmpresasQueAtiende } from "../lib/bodega/empresas";
import { listarAccionesSuperadmin } from "../lib/superadmin";

// PR login-bodega-domiciliario — contra Postgres real: el ciclo completo
// (superadmin crea y suspende, invita al admin; el admin invita y
// administra) y el aislamiento CRUZADO: una bodega no lee nada de
// empresas de vendedores y un vendedor no lee nada de bodegas_3pl.
describe("bodegas 3PL (RLS + lib, PR login-bodega-domiciliario)", () => {
  const sufijo = randomUUID().slice(0, 8);
  const superadminId = randomUUID();
  const adminId = randomUUID();
  const operarioId = randomUUID();
  const domiciliarioId = randomUUID();
  const intrusoId = randomUUID();
  let bodegaA: string;
  let bodegaB: string;
  let empresaId: string;
  let usuarioVendedorId: string;
  let tokenOperario: string;

  async function usuario(id: string, extra: Partial<typeof usuarios.$inferInsert> = {}) {
    await db.insert(usuarios).values({ id, email: `bodega-${id.slice(0, 8)}@zilonix.test`, nombre: `Persona ${id.slice(0, 4)}`, ...extra });
  }

  beforeAll(async () => {
    await usuario(superadminId, { esSuperadmin: true });
    for (const id of [adminId, operarioId, domiciliarioId, intrusoId]) await usuario(id);
    const ctx = await crearDosEmpresas();
    empresaId = ctx.empresaAId;
    usuarioVendedorId = ctx.usuarioAId;
    bodegaA = (await crearBodega(superadminId, { nombre: `Bodega A ${sufijo}`, nit: "" })).id;
    bodegaB = (await crearBodega(superadminId, { nombre: `Bodega B ${sufijo}`, nit: "" })).id;
  });

  it("el superadmin ve las bodegas con conteos, no quiénes son", async () => {
    const lista = await listarBodegas();
    const a = lista.find((b) => b.id === bodegaA);
    expect(a).toMatchObject({ estado: "activa", admins: 0, operarios: 0, domiciliarios: 0 });
  });

  it("invitación del admin: válida se acepta, usada y token inexistente se rechazan", async () => {
    const { token } = await invitarAdminBodega(superadminId, bodegaA, "admin-bodega@zilonix.test");
    expect(await obtenerInvitacionBodegaPorToken(token)).toMatchObject({ rol: "admin_bodega", estado: "valida", bodegaNombre: `Bodega A ${sufijo}` });

    const { bodegaId, rol } = await aceptarInvitacionBodega(token, adminId);
    expect(bodegaId).toBe(bodegaA);
    expect(rol).toBe("admin_bodega");
    expect((await obtenerInvitacionBodegaPorToken(token))?.estado).toBe("usada");
    await expect(aceptarInvitacionBodega(token, intrusoId)).rejects.toBeInstanceOf(InvitacionBodegaInvalidaError);
    await expect(aceptarInvitacionBodega("token-que-no-existe", intrusoId)).rejects.toBeInstanceOf(InvitacionBodegaInvalidaError);
    expect(await listarMembresiasDeUsuario(intrusoId)).toHaveLength(0);
  });

  it("invitación vencida no se puede aceptar", async () => {
    const token = `vencida-${randomUUID()}`;
    await dbSuperadmin.insert(invitacionesBodega3pl).values({
      id: randomUUID(), bodegaId: bodegaA, email: "tarde@zilonix.test", rol: "admin_bodega", bodegaNombre: "x", token, invitadoPor: superadminId, expiraTs: new Date(Date.now() - 1000),
    });
    expect((await obtenerInvitacionBodegaPorToken(token))?.estado).toBe("vencida");
    await expect(aceptarInvitacionBodega(token, intrusoId)).rejects.toThrow("venció");
  });

  it("el admin invita operario y domiciliario; ellos aceptan", async () => {
    const op = await crearInvitacionBodega({ bodegaId: bodegaA, bodegaNombre: "Bodega A", email: "op@zilonix.test", rol: "operario", invitadoPor: adminId });
    tokenOperario = op.token;
    const dom = await crearInvitacionBodega({ bodegaId: bodegaA, bodegaNombre: "Bodega A", email: "dom@zilonix.test", rol: "domiciliario", invitadoPor: adminId });
    await aceptarInvitacionBodega(op.token, operarioId);
    await aceptarInvitacionBodega(dom.token, domiciliarioId);
    const roles = (await listarMiembros(bodegaA)).map((m) => m.rol).sort();
    expect(roles).toEqual(["admin_bodega", "domiciliario", "operario"]);
    await expect(crearInvitacionBodega({ bodegaId: bodegaA, bodegaNombre: "x", email: "otro@zilonix.test", rol: "admin_bodega", invitadoPor: adminId })).rejects.toThrow();
  });

  it("cambiar rol y desactivar/reactivar; nadie se cambia a sí mismo ni toca al admin", async () => {
    const miembros = await listarMiembros(bodegaA);
    const operario = miembros.find((m) => m.usuarioId === operarioId)!;
    const admin = miembros.find((m) => m.usuarioId === adminId)!;

    await cambiarRolDeMiembro(bodegaA, adminId, operario.miembroId, "domiciliario", "admin_bodega");
    expect((await listarMiembros(bodegaA)).find((m) => m.usuarioId === operarioId)?.rol).toBe("domiciliario");
    await cambiarActivoDeMiembro(bodegaA, adminId, operario.miembroId, false, "admin_bodega");
    expect((await listarMembresiasDeUsuario(operarioId))[0].activo).toBe(false);
    await cambiarActivoDeMiembro(bodegaA, adminId, operario.miembroId, true, "admin_bodega");

    await expect(cambiarRolDeMiembro(bodegaA, adminId, admin.miembroId, "operario", "admin_bodega")).rejects.toBeInstanceOf(CambioBodegaInvalidoError);
    await expect(cambiarRolDeMiembro(bodegaA, operarioId, operario.miembroId, "operario", "operario")).rejects.toBeInstanceOf(CambioBodegaInvalidoError);
    await expect(cambiarRolDeMiembro(bodegaA, adminId, operario.miembroId, "admin_bodega", "admin_bodega")).rejects.toBeInstanceOf(CambioBodegaInvalidoError);
    // Una bodega ajena no puede editar a este miembro.
    await expect(cambiarActivoDeMiembro(bodegaB, adminId, operario.miembroId, false, "admin_bodega")).rejects.toBeInstanceOf(CambioBodegaInvalidoError);
  });

  it("suspender y reactivar cambian el estado y quedan en auditoria", async () => {
    await suspenderBodega(superadminId, bodegaA, "Prueba de suspensión");
    expect((await listarMembresiasDeUsuario(adminId))[0].bodegaEstado).toBe("suspendida");
    await reactivarBodega(superadminId, bodegaA);
    expect((await listarMembresiasDeUsuario(adminId))[0].bodegaEstado).toBe("activa");

    const acciones = (await dbComoBodega(bodegaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.bodegaId, bodegaA)))).map((a) => a.accion);
    for (const esperada of ["crear_bodega", "invitar_admin_bodega", "aceptar_invitacion", "invitar", "cambiar_rol", "desactivar_miembro", "reactivar_miembro", "suspender_bodega", "reactivar_bodega"]) {
      expect(acciones, esperada).toContain(esperada);
    }
    const delSuperadmin = (await listarAccionesSuperadmin(200)).filter((a) => a.empresaNombre === `Bodega A ${sufijo}`).map((a) => a.accion);
    expect(delSuperadmin).toContain("suspender_bodega");
  });

  describe("solo admin_bodega edita la bodega y sus miembros (RLS)", () => {
    async function miembroId(usuarioId: string) {
      return (await listarMiembros(bodegaA)).find((m) => m.usuarioId === usuarioId)!.miembroId;
    }

    it("operario y domiciliario no cambian nombre/NIT, rol ni estado (0 filas)", async () => {
      const objetivo = await miembroId(operarioId);
      for (const rol of ["operario", "domiciliario", undefined]) {
        const b = await dbComoBodega(bodegaA, (tx) => tx.update(bodegas3pl).set({ nombre: "Hackeada" }).where(eq(bodegas3pl.id, bodegaA)).returning({ id: bodegas3pl.id }), rol);
        expect(b).toHaveLength(0);
        const r = await dbComoBodega(bodegaA, (tx) => tx.update(miembrosBodega3pl).set({ rol: "domiciliario" }).where(eq(miembrosBodega3pl.id, objetivo)).returning({ id: miembrosBodega3pl.id }), rol);
        expect(r).toHaveLength(0);
        const a = await dbComoBodega(bodegaA, (tx) => tx.update(miembrosBodega3pl).set({ activo: false }).where(eq(miembrosBodega3pl.id, objetivo)).returning({ id: miembrosBodega3pl.id }), rol);
        expect(a).toHaveLength(0);
      }
      const [b] = await dbComoBodega(bodegaA, (tx) => tx.select().from(bodegas3pl).where(eq(bodegas3pl.id, bodegaA)));
      expect(b.nombre).toBe(`Bodega A ${sufijo}`);
    });

    it("el admin_bodega sí edita su bodega y sus miembros", async () => {
      await actualizarDatosBodega(bodegaA, adminId, { nombre: `Bodega A ${sufijo}`, nit: "900123" }, "admin_bodega");
      const [b] = await dbComoBodega(bodegaA, (tx) => tx.select().from(bodegas3pl).where(eq(bodegas3pl.id, bodegaA)));
      expect(b.nit).toBe("900123");
    });

    it("una bodega no edita a otra, ni siendo admin", async () => {
      const filas = await dbComoBodega(bodegaB, (tx) => tx.update(bodegas3pl).set({ nombre: "Ajena" }).where(eq(bodegas3pl.id, bodegaA)).returning({ id: bodegas3pl.id }), "admin_bodega");
      expect(filas).toHaveLength(0);
      const objetivo = await miembroId(operarioId);
      const m = await dbComoBodega(bodegaB, (tx) => tx.update(miembrosBodega3pl).set({ activo: false }).where(eq(miembrosBodega3pl.id, objetivo)).returning({ id: miembrosBodega3pl.id }), "admin_bodega");
      expect(m).toHaveLength(0);
    });

    it("el superadmin sigue suspendiendo y reactivando", async () => {
      await suspenderBodega(superadminId, bodegaB, "Prueba");
      await reactivarBodega(superadminId, bodegaB);
    });
  });

  describe("aislamiento cruzado", () => {
    it("un vendedor no lee nada de bodegas_3pl (ni con su usuario)", async () => {
      expect(await dbComoEmpresa(empresaId, (tx) => tx.select().from(bodegas3pl))).toHaveLength(0);
      expect(await dbComoEmpresa(empresaId, (tx) => tx.select().from(miembrosBodega3pl))).toHaveLength(0);
      expect(await dbComoEmpresa(empresaId, (tx) => tx.select().from(invitacionesBodega3pl))).toHaveLength(0);
      expect(await dbComoUsuario(adminId, (tx) => tx.select().from(bodegas3pl))).toHaveLength(0);
      expect(await dbComoUsuario(adminId, (tx) => tx.select().from(miembrosBodega3pl))).toHaveLength(0);
      const auditoriaVista = await dbComoEmpresa(empresaId, (tx) => tx.select().from(auditoria).where(eq(auditoria.bodegaId, bodegaA)));
      expect(auditoriaVista).toHaveLength(0);
    });

    it("una bodega (o un domiciliario) no lee nada de empresas de vendedores", async () => {
      expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(empresas))).toHaveLength(0);
      expect(await dbComoUsuarioBodega(adminId, (tx) => tx.select().from(empresas))).toHaveLength(0);
      expect(await dbComoUsuarioBodega(domiciliarioId, (tx) => tx.select().from(empresas))).toHaveLength(0);
      expect(usuarioVendedorId).toBeTruthy();
    });

    it("una bodega no ve nada de otra bodega", async () => {
      expect((await dbComoBodega(bodegaB, (tx) => tx.select().from(bodegas3pl))).map((b) => b.id)).toEqual([bodegaB]);
      expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(miembrosBodega3pl))).toHaveLength(0);
      expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(invitacionesBodega3pl))).toHaveLength(0);
      expect((await dbComoUsuarioBodega(adminId, (tx) => tx.select().from(bodegas3pl))).map((b) => b.id)).toEqual([bodegaA]);
    });

    it("sin el token no se ve ninguna invitación; con otro token tampoco", async () => {
      expect(await dbComoInvitacionBodega("no-es-el-token", null, (tx) => tx.select().from(invitacionesBodega3pl))).toHaveLength(0);
      expect(tokenOperario).toBeTruthy();
    });

    it("la base impide saltarse el flujo: crear bodegas, cambiar estado, invitar admins o unirse sin invitación", async () => {
      await expect(dbComoBodega(bodegaA, (tx) => tx.insert(bodegas3pl).values({ nombre: "Pirata" }))).rejects.toThrow();
      await expect(dbComoBodega(bodegaA, (tx) => tx.update(bodegas3pl).set({ estado: "suspendida" }).where(eq(bodegas3pl.id, bodegaA)))).rejects.toThrow();
      await expect(
        dbComoBodega(bodegaA, (tx) =>
          tx.insert(invitacionesBodega3pl).values({ bodegaId: bodegaA, email: "x@zilonix.test", rol: "admin_bodega", bodegaNombre: "x", token: `t-${randomUUID()}`, invitadoPor: adminId, expiraTs: new Date(Date.now() + 1000) })
        )
      ).rejects.toThrow();
      await expect(dbComoInvitacionBodega("sin-invitacion", intrusoId, (tx) => tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaB, usuarioId: intrusoId, rol: "operario" }))).rejects.toThrow();
      // superadmin_user solo invita admin_bodega.
      await expect(
        dbSuperadmin.insert(invitacionesBodega3pl).values({ bodegaId: bodegaA, email: "x@zilonix.test", rol: "operario", bodegaNombre: "x", token: `t-${randomUUID()}`, invitadoPor: superadminId, expiraTs: new Date(Date.now() + 1000) })
      ).rejects.toThrow();
    });
  });
});

// Issue #625 (Bodega-1, migración 0044) — vínculo bodega↔empresa y tablas
// de recepción/stock, contra Postgres real. No usa afirmarAislamiento:
// app_user no tiene UPDATE/DELETE sobre estas tablas (daría "permission
// denied", ver #636), así que cada negación se afirma a mano.
describe("bodegas 3PL ligadas a empresas (RLS, issue #625)", () => {
  const sufijo = randomUUID().slice(0, 8);
  const superadminId = randomUUID();
  let bodegaA: string;
  let bodegaB: string;
  let empresaA: string;
  let empresaB: string;
  let empresaC: string;
  let recepcionId: string;

  beforeAll(async () => {
    await db.insert(usuarios).values({ id: superadminId, email: `vinculo-${sufijo}@zilonix.test`, nombre: "Superadmin vínculo", esSuperadmin: true });
    const ctx = await crearDosEmpresas();
    empresaA = ctx.empresaAId;
    empresaB = ctx.empresaBId;
    empresaC = randomUUID();
    await dbComoEmpresa(empresaC, (tx) => tx.insert(empresas).values({ id: empresaC, nombre: `Empresa C ${sufijo}`, nit: `TEST-VINC-C-${sufijo}` }));
    bodegaA = (await crearBodega(superadminId, { nombre: `Bodega vínculo A ${sufijo}`, nit: "" })).id;
    bodegaB = (await crearBodega(superadminId, { nombre: `Bodega vínculo B ${sufijo}`, nit: "" })).id;
    await ligarEmpresaABodega(superadminId, bodegaA, empresaA);
    await ligarEmpresaABodega(superadminId, bodegaB, empresaB);
  });

  it("ligar es único por bodega y empresa, queda en auditoría y pausar/reactivar también", async () => {
    await expect(ligarEmpresaABodega(superadminId, bodegaA, empresaA)).rejects.toBeInstanceOf(BodegaInvalidaError);
    await expect(ligarEmpresaABodega(superadminId, bodegaA, randomUUID())).rejects.toBeInstanceOf(BodegaInvalidaError);
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "pausada");
    expect((await listarEmpresasQueAtiende(bodegaA))[0].estado).toBe("pausada");
    await cambiarEstadoVinculo(superadminId, bodegaA, empresaA, "activa");
    await expect(cambiarEstadoVinculo(superadminId, bodegaA, empresaC, "pausada")).rejects.toBeInstanceOf(BodegaInvalidaError);
    const acciones = (await dbComoBodega(bodegaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.bodegaId, bodegaA)))).map((a) => a.accion);
    for (const esperada of ["ligar_empresa_bodega", "pausar_empresa_bodega", "reactivar_empresa_bodega"]) expect(acciones, esperada).toContain(esperada);
  });

  it("la bodega ve solo sus empresas ligadas (solo nombre) y no las de otra bodega", async () => {
    const deA = await listarEmpresasQueAtiende(bodegaA);
    expect(deA.map((e) => e.empresaId)).toEqual([empresaA]);
    expect(Object.keys(deA[0]).sort()).toEqual(["empresaId", "estado", "nombre"]);
    expect((await listarEmpresasQueAtiende(bodegaB)).map((e) => e.empresaId)).toEqual([empresaB]);
    // Empresa C no está ligada a nadie: ninguna bodega la ve.
    for (const b of [bodegaA, bodegaB]) {
      expect((await dbComoBodega(b, (tx) => tx.select({ id: empresas.id }).from(empresas))).map((e) => e.id)).not.toContain(empresaC);
    }
    expect((await dbComoBodega(bodegaA, (tx) => tx.select().from(bodegas3plEmpresas))).map((v) => v.bodegaId)).toEqual([bodegaA]);
  });

  it("el vendedor ve su bodega (solo nombre y estado) y no los vínculos de otra empresa", async () => {
    expect((await listarBodegasQueAtiendenEmpresa(empresaA)).map((b) => b.bodegaId)).toEqual([bodegaA]);
    expect(await listarBodegasQueAtiendenEmpresa(empresaC)).toHaveLength(0);
    expect((await dbComoEmpresa(empresaA, (tx) => tx.select().from(bodegas3plEmpresas))).map((v) => v.empresaId)).toEqual([empresaA]);
    expect((await dbComoEmpresa(empresaA, (tx) => tx.select({ id: bodegas3pl.id }).from(bodegas3pl))).map((b) => b.id)).toEqual([bodegaA]);
  });

  it("ni la bodega ni la empresa pueden ligar, pausar ni borrar vínculos", async () => {
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(bodegas3plEmpresas).values({ bodegaId: bodegaA, empresaId: empresaC, creadoPor: superadminId }))).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.update(bodegas3plEmpresas).set({ estado: "pausada" }))).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.delete(bodegas3plEmpresas))).rejects.toThrow();
    await expect(dbComoEmpresa(empresaA, (tx) => tx.insert(bodegas3plEmpresas).values({ bodegaId: bodegaB, empresaId: empresaA, creadoPor: superadminId }))).rejects.toThrow();
    await expect(dbComoEmpresa(empresaA, (tx) => tx.update(bodegas3plEmpresas).set({ estado: "pausada" }))).rejects.toThrow();
  });

  it("recepciones e ítems: la bodega crea con empresa ligada activa; la empresa solo lee lo suyo", async () => {
    recepcionId = randomUUID();
    await dbComoBodega(bodegaA, async (tx) => {
      await tx.insert(recepcionesBodega3pl).values({ id: recepcionId, bodegaId: bodegaA, empresaId: empresaA, creadoPor: superadminId });
      await tx.insert(recepcionItemsBodega3pl).values({ recepcionId, sku: "SKU-1", cantidad: 5 });
    });
    // Empresa no ligada a esa bodega, o bodega ajena: la base lo rechaza.
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(recepcionesBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaB, creadoPor: superadminId }))).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(recepcionesBodega3pl).values({ bodegaId: bodegaB, empresaId: empresaB, creadoPor: superadminId }))).rejects.toThrow();
    // Cantidad > 0.
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(recepcionItemsBodega3pl).values({ recepcionId, sku: "SKU-2", cantidad: 0 }))).rejects.toThrow();
    // Un ítem no se agrega a la recepción de otra bodega.
    await expect(dbComoBodega(bodegaB, (tx) => tx.insert(recepcionItemsBodega3pl).values({ recepcionId, sku: "SKU-3", cantidad: 1 }))).rejects.toThrow();

    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(recepcionesBodega3pl))).toHaveLength(1);
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(recepcionesBodega3pl))).toHaveLength(0);
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(recepcionItemsBodega3pl))).toHaveLength(0);
    expect(await dbComoEmpresa(empresaA, (tx) => tx.select().from(recepcionItemsBodega3pl))).toHaveLength(1);
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(recepcionesBodega3pl))).toHaveLength(0);
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(recepcionItemsBodega3pl))).toHaveLength(0);
    // La empresa no crea recepciones ni ítems.
    await expect(dbComoEmpresa(empresaA, (tx) => tx.insert(recepcionesBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaA, creadoPor: superadminId }))).rejects.toThrow();
    await expect(dbComoEmpresa(empresaA, (tx) => tx.insert(recepcionItemsBodega3pl).values({ recepcionId, sku: "SKU-4", cantidad: 1 }))).rejects.toThrow();
  });

  it("stock: único por bodega, empresa y sku, nunca negativo; la empresa solo lee", async () => {
    await dbComoBodega(bodegaA, (tx) => tx.insert(stockBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaA, sku: "SKU-1", cantidad: 5 }));
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(stockBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaA, sku: "SKU-1", cantidad: 1 }))).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(stockBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaA, sku: "SKU-N", cantidad: -1 }))).rejects.toThrow();
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(stockBodega3pl).values({ bodegaId: bodegaA, empresaId: empresaB, sku: "SKU-1", cantidad: 1 }))).rejects.toThrow();

    const editada = await dbComoBodega(bodegaA, (tx) => tx.update(stockBodega3pl).set({ cantidad: 7 }).where(eq(stockBodega3pl.sku, "SKU-1")).returning({ id: stockBodega3pl.id }));
    expect(editada).toHaveLength(1);
    // Otra bodega no edita ese stock (0 filas) ni lo ve.
    expect(await dbComoBodega(bodegaB, (tx) => tx.update(stockBodega3pl).set({ cantidad: 99 }).where(eq(stockBodega3pl.sku, "SKU-1")).returning({ id: stockBodega3pl.id }))).toHaveLength(0);
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(stockBodega3pl))).toHaveLength(0);

    expect((await dbComoEmpresa(empresaA, (tx) => tx.select().from(stockBodega3pl))).map((s) => s.cantidad)).toEqual([7]);
    expect(await dbComoEmpresa(empresaB, (tx) => tx.select().from(stockBodega3pl))).toHaveLength(0);
    // La empresa tiene UPDATE (cantidad) pero la política solo deja pasar a la bodega: RLS filtra a 0 filas, sin error.
    expect(await dbComoEmpresa(empresaA, (tx) => tx.update(stockBodega3pl).set({ cantidad: 1 }).returning({ id: stockBodega3pl.id }))).toHaveLength(0);
    expect((await dbComoEmpresa(empresaA, (tx) => tx.select().from(stockBodega3pl))).map((s) => s.cantidad)).toEqual([7]);
  });

  it("el superadmin ve los vínculos pero no recepciones ni stock", async () => {
    expect((await dbSuperadmin.select().from(bodegas3plEmpresas)).length).toBeGreaterThanOrEqual(2);
    await expect(dbSuperadmin.select().from(recepcionesBodega3pl)).rejects.toThrow();
    await expect(dbSuperadmin.select().from(stockBodega3pl)).rejects.toThrow();
  });
});
