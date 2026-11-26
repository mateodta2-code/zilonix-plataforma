import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoAutorregistroBodega, dbComoBodega, dbComoUsuarioBodega } from "./bodega-context";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { auditoria, bodegas3pl, miembrosBodega3pl, perfilesDomiciliario, usuarios } from "./schema";
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

  it("los ids inválidos se rechazan antes de tocar la base", async () => {
    await expect(dbComoAutorregistroBodega("no-uuid", bodegaA, async () => 1)).rejects.toThrow("usuarioId inválido");
    await expect(dbComoAutorregistroBodega(usuarioA, "no-uuid", async () => 1)).rejects.toThrow("bodegaIdNueva inválido");
  });
});
