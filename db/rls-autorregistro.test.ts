import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoAutorregistroBodega, dbComoBodega, dbComoUsuarioBodega } from "./bodega-context";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { auditoria, bodegas3pl, roles, membresias, miembrosBodega3pl, perfilesDomiciliario, sedesBodega, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// Registro-0 — contra Postgres real: una persona crea SU bodega y se vuelve
// su único admin; nadie se hace admin de una bodega ajena; el perfil de
// domiciliario es solo de su dueño; un vendedor no ve nada de esto.
describe("autorregistro de bodegas y domiciliarios (RLS, Registro-0)", () => {
  const sufijo = randomUUID().slice(0, 8);
  const usuarioA = randomUUID();
  const usuarioB = randomUUID();
  const bodegaA = randomUUID();
  let empresaId: string;

  beforeAll(async () => {
    for (const id of [usuarioA, usuarioB]) {
      await db.insert(usuarios).values({ id, email: `autorregistro-${id.slice(0, 8)}@zilonix.test`, nombre: `Persona ${id.slice(0, 4)}` });
    }
    empresaId = (await crearDosEmpresas()).empresaAId;
  });

  it("A crea su bodega autorregistro y se vuelve admin_bodega, con auditoría", async () => {
    await dbComoAutorregistroBodega(usuarioA, bodegaA, async (tx) => {
      await tx.insert(bodegas3pl).values({ id: bodegaA, nombre: `Bodega Auto ${sufijo}`, origen: "autorregistro", creadoPor: usuarioA });
      await tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaA, usuarioId: usuarioA, rol: "admin_bodega" });
      await tx.insert(auditoria).values({ bodegaId: bodegaA, usuarioId: usuarioA, actorTipo: "persona", accion: "autorregistro", entidad: "bodega_3pl", entidadId: bodegaA });
    });
    const filas = await dbComoBodega(bodegaA, (tx) => tx.select().from(auditoria).where(eq(auditoria.bodegaId, bodegaA)), "admin_bodega", usuarioA);
    expect(filas).toHaveLength(1);
    const miembros = await dbComoBodega(bodegaA, (tx) => tx.select().from(miembrosBodega3pl), "admin_bodega", usuarioA);
    expect(miembros).toMatchObject([{ usuarioId: usuarioA, rol: "admin_bodega" }]);
  });

  it("A no puede crear una segunda bodega autorregistro", async () => {
    const otra = randomUUID();
    await expect(
      dbComoAutorregistroBodega(usuarioA, otra, (tx) => tx.insert(bodegas3pl).values({ id: otra, nombre: "Segunda", origen: "autorregistro", creadoPor: usuarioA }))
    ).rejects.toThrow();
  });

  it("B no puede insertar con origen superadmin, estado suspendida ni creado_por de otro", async () => {
    const id1 = randomUUID();
    await expect(dbComoAutorregistroBodega(usuarioB, id1, (tx) => tx.insert(bodegas3pl).values({ id: id1, nombre: "X", origen: "superadmin", creadoPor: usuarioB }))).rejects.toThrow();
    const id2 = randomUUID();
    await expect(dbComoAutorregistroBodega(usuarioB, id2, (tx) => tx.insert(bodegas3pl).values({ id: id2, nombre: "X", origen: "autorregistro", estado: "suspendida", creadoPor: usuarioB }))).rejects.toThrow();
    const id3 = randomUUID();
    await expect(dbComoAutorregistroBodega(usuarioB, id3, (tx) => tx.insert(bodegas3pl).values({ id: id3, nombre: "X", origen: "autorregistro", creadoPor: usuarioA }))).rejects.toThrow();
  });

  it("B no puede hacerse admin de la bodega de A, ni A agregar un segundo admin", async () => {
    await expect(
      dbComoAutorregistroBodega(usuarioB, bodegaA, (tx) => tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaA, usuarioId: usuarioB, rol: "admin_bodega" }))
    ).rejects.toThrow();
    // A (ya admin) intenta meter a B como admin: ni es su propia fila ni la bodega está vacía.
    await expect(
      dbComoAutorregistroBodega(usuarioA, bodegaA, (tx) => tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaA, usuarioId: usuarioB, rol: "admin_bodega" }))
    ).rejects.toThrow();
    // Ni A segundo registro propio como otro rol.
    await expect(
      dbComoAutorregistroBodega(usuarioA, bodegaA, (tx) => tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaA, usuarioId: usuarioA, rol: "operario" }))
    ).rejects.toThrow();
    const miembros = await dbComoBodega(bodegaA, (tx) => tx.select().from(miembrosBodega3pl), "admin_bodega", usuarioA);
    expect(miembros).toHaveLength(1);
  });

  it("perfil de domiciliario: cada quien solo ve y cambia el suyo", async () => {
    await dbComoUsuarioBodega(usuarioA, (tx) => tx.insert(perfilesDomiciliario).values({ usuarioId: usuarioA, nombre: "Ana" }));
    await dbComoUsuarioBodega(usuarioB, (tx) => tx.insert(perfilesDomiciliario).values({ usuarioId: usuarioB, nombre: "Beto", ciudad: "Cali" }));
    // No puede crear el perfil de otro.
    await expect(dbComoUsuarioBodega(usuarioA, (tx) => tx.insert(perfilesDomiciliario).values({ usuarioId: randomUUID(), nombre: "Falso" }))).rejects.toThrow();

    const verA = await dbComoUsuarioBodega(usuarioA, (tx) => tx.select().from(perfilesDomiciliario));
    expect(verA).toHaveLength(1);
    expect(verA[0].usuarioId).toBe(usuarioA);

    // UPDATE sobre la fila de B: RLS la oculta, no cambia nada.
    await dbComoUsuarioBodega(usuarioA, (tx) => tx.update(perfilesDomiciliario).set({ nombre: "Hackeado" }).where(eq(perfilesDomiciliario.usuarioId, usuarioB)));
    const verB = await dbComoUsuarioBodega(usuarioB, (tx) => tx.select().from(perfilesDomiciliario));
    expect(verB[0].nombre).toBe("Beto");

    // Sí cambia el suyo; no puede borrar.
    await dbComoUsuarioBodega(usuarioA, (tx) => tx.update(perfilesDomiciliario).set({ telefono: "300" }).where(eq(perfilesDomiciliario.usuarioId, usuarioA)));
    expect((await dbComoUsuarioBodega(usuarioA, (tx) => tx.select().from(perfilesDomiciliario)))[0].telefono).toBe("300");
    await expect(dbComoUsuarioBodega(usuarioA, (tx) => tx.delete(perfilesDomiciliario).where(eq(perfilesDomiciliario.usuarioId, usuarioA)))).rejects.toThrow();
  });

  it("auditoría del perfil: solo la propia, sin bodega ni empresa", async () => {
    await dbComoUsuarioBodega(usuarioA, (tx) => tx.insert(auditoria).values({ usuarioId: usuarioA, actorTipo: "persona", accion: "crear", entidad: "perfil_domiciliario" }));
    await expect(dbComoUsuarioBodega(usuarioA, (tx) => tx.insert(auditoria).values({ usuarioId: usuarioB, actorTipo: "persona", accion: "crear", entidad: "perfil_domiciliario" }))).rejects.toThrow();
    await expect(dbComoUsuarioBodega(usuarioA, (tx) => tx.insert(auditoria).values({ usuarioId: usuarioA, actorTipo: "persona", accion: "crear", entidad: "otra_cosa" }))).rejects.toThrow();
  });

  it("un vendedor no lee perfiles_domiciliario ni bodegas_3pl", async () => {
    expect(await dbComoEmpresa(empresaId, (tx) => tx.select().from(perfilesDomiciliario))).toHaveLength(0);
    expect(await dbComoEmpresa(empresaId, (tx) => tx.select().from(bodegas3pl))).toHaveLength(0);
  });

  it("un usuario con empresa de vendedor también crea su bodega y su perfil de domiciliario", async () => {
    const usuarioC = randomUUID();
    const bodegaC = randomUUID();
    await db.insert(usuarios).values({ id: usuarioC, email: `autorregistro-${usuarioC.slice(0, 8)}@zilonix.test`, nombre: "Persona C" });
    const rolId = randomUUID();
    await dbComoEmpresa(empresaId, async (tx) => {
      await tx.insert(roles).values({ id: rolId, nombre: "Dueño", empresaId });
      await tx.insert(membresias).values({ usuarioId: usuarioC, empresaId, rolId });
    });
    await dbComoAutorregistroBodega(usuarioC, bodegaC, async (tx) => {
      await tx.insert(bodegas3pl).values({ id: bodegaC, nombre: `Bodega C ${sufijo}`, origen: "autorregistro", creadoPor: usuarioC });
      await tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaC, usuarioId: usuarioC, rol: "admin_bodega" });
      await tx.insert(sedesBodega).values({ bodegaId: bodegaC, nombre: "Principal" });
    });
    await dbComoUsuarioBodega(usuarioC, (tx) => tx.insert(perfilesDomiciliario).values({ usuarioId: usuarioC, nombre: "Carlos" }));
    expect(await dbComoUsuarioBodega(usuarioC, (tx) => tx.select().from(perfilesDomiciliario))).toHaveLength(1);
  });

  it("sedes: el admin de A crea y edita; el operario solo lee; B y el vendedor no ven; nadie borra", async () => {
    const operario = randomUUID();
    const bodegaB = randomUUID();
    await db.insert(usuarios).values({ id: operario, email: `autorregistro-${operario.slice(0, 8)}@zilonix.test`, nombre: "Operario A" });
    await db.insert(miembrosBodega3pl).values({ bodegaId: bodegaA, usuarioId: operario, rol: "operario" });
    await dbComoAutorregistroBodega(usuarioB, bodegaB, async (tx) => {
      await tx.insert(bodegas3pl).values({ id: bodegaB, nombre: `Bodega B ${sufijo}`, origen: "autorregistro", creadoPor: usuarioB });
      await tx.insert(miembrosBodega3pl).values({ bodegaId: bodegaB, usuarioId: usuarioB, rol: "admin_bodega" });
    });

    await dbComoBodega(bodegaA, (tx) => tx.insert(sedesBodega).values([{ bodegaId: bodegaA, nombre: "Norte" }, { bodegaId: bodegaA, nombre: "Sur", ciudad: "Cali" }]), "admin_bodega", usuarioA);
    await dbComoBodega(bodegaA, (tx) => tx.update(sedesBodega).set({ direccion: "Calle 1", activa: false }).where(eq(sedesBodega.nombre, "Norte")), "admin_bodega", usuarioA);
    const deA = await dbComoBodega(bodegaA, (tx) => tx.select().from(sedesBodega).where(eq(sedesBodega.nombre, "Norte")), "admin_bodega", usuarioA);
    expect(deA[0]).toMatchObject({ direccion: "Calle 1", activa: false });
    // Nombre repetido en la misma bodega.
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(sedesBodega).values({ bodegaId: bodegaA, nombre: "Sur" }), "admin_bodega", usuarioA)).rejects.toThrow();

    // Operario: lee, no crea ni edita.
    expect((await dbComoBodega(bodegaA, (tx) => tx.select().from(sedesBodega), "operario", operario)).length).toBeGreaterThanOrEqual(2);
    await expect(dbComoBodega(bodegaA, (tx) => tx.insert(sedesBodega).values({ bodegaId: bodegaA, nombre: "Op" }), "operario", operario)).rejects.toThrow();
    await dbComoBodega(bodegaA, (tx) => tx.update(sedesBodega).set({ nombre: "Hack" }).where(eq(sedesBodega.nombre, "Sur")), "operario", operario);
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(sedesBodega).where(eq(sedesBodega.nombre, "Hack")), "admin_bodega", usuarioA)).toHaveLength(0);

    // Bodega B: no ve ni cambia las de A, ni crea en A.
    expect(await dbComoBodega(bodegaB, (tx) => tx.select().from(sedesBodega).where(eq(sedesBodega.bodegaId, bodegaA)), "admin_bodega", usuarioB)).toHaveLength(0);
    await dbComoBodega(bodegaB, (tx) => tx.update(sedesBodega).set({ nombre: "Hack" }).where(eq(sedesBodega.bodegaId, bodegaA)), "admin_bodega", usuarioB);
    expect(await dbComoBodega(bodegaA, (tx) => tx.select().from(sedesBodega).where(eq(sedesBodega.nombre, "Hack")), "admin_bodega", usuarioA)).toHaveLength(0);
    await expect(dbComoBodega(bodegaB, (tx) => tx.insert(sedesBodega).values({ bodegaId: bodegaA, nombre: "Intruso" }), "admin_bodega", usuarioB)).rejects.toThrow();

    // Vendedor: nada. Nadie borra.
    expect(await dbComoEmpresa(empresaId, (tx) => tx.select().from(sedesBodega))).toHaveLength(0);
    await expect(dbComoBodega(bodegaA, (tx) => tx.delete(sedesBodega).where(eq(sedesBodega.bodegaId, bodegaA)), "admin_bodega", usuarioA)).rejects.toThrow();
  });

  it("los ids inválidos se rechazan antes de tocar la base", async () => {
    await expect(dbComoAutorregistroBodega("no-uuid", bodegaA, async () => 1)).rejects.toThrow("usuarioId inválido");
    await expect(dbComoAutorregistroBodega(usuarioA, "no-uuid", async () => 1)).rejects.toThrow("bodegaIdNueva inválido");
  });
});
