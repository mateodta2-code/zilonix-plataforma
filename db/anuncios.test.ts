import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "./index";
import { dbSuperadmin } from "./superadmin-context";
import { anunciosPlataforma, usuarios } from "./schema";
import { AnuncioInvalidoError, anunciosVigentes, crearAnuncio, listarAnuncios, retirarAnuncio } from "../lib/anuncios";

// Anuncios de la plataforma (25-nov, migración 0050) — contra Postgres real:
// el superadmin crea y retira (con auditoría); el vendedor (app_user) solo
// lee los vigentes y no escribe nada; nadie edita el texto ni borra.
describe("anuncios_plataforma", () => {
  const superadminId = randomUUID();
  const sufijo = randomUUID().slice(0, 8);
  const ahora = new Date();
  const enColombia = (d: Date) => new Date(d.getTime() - 5 * 3600_000).toISOString().slice(0, 16);
  let vigente: string;
  let programado: string;

  beforeAll(async () => {
    await db.insert(usuarios).values({ id: superadminId, email: `anuncios-${sufijo}@zilonix.test`, nombre: "Superadmin Anuncios", esSuperadmin: true });
    vigente = await crearAnuncio(superadminId, { mensaje: `Vigente ${sufijo}`, tipo: "advertencia", desde: "", hasta: "" });
    programado = await crearAnuncio(superadminId, { mensaje: `Programado ${sufijo}`, tipo: "info", desde: enColombia(new Date(ahora.getTime() + 3 * 3600_000)), hasta: "" });
  });

  it("el vendedor ve el vigente y no el programado; tras retirarlo, deja de verlo", async () => {
    const ids = (await anunciosVigentes()).map((a) => a.id);
    expect(ids).toContain(vigente);
    expect(ids).not.toContain(programado);

    await retirarAnuncio(superadminId, vigente);
    expect((await anunciosVigentes()).map((a) => a.id)).not.toContain(vigente);
    // Retirar dos veces no se puede.
    await expect(retirarAnuncio(superadminId, vigente)).rejects.toBeInstanceOf(AnuncioInvalidoError);

    // El superadmin sigue viéndolos todos, con su estado.
    const todos = await listarAnuncios();
    expect(todos.find((a) => a.id === vigente)?.retiradoTs).toBeTruthy();
    expect(todos.find((a) => a.id === programado)).toBeTruthy();
  });

  it("crear y retirar quedan en auditoría", async () => {
    const rastro = await dbSuperadmin.execute(sql`select * from superadmin_acciones_recientes(200)`);
    const acciones = (rastro as unknown as { accion: string; detalle: string }[]).filter((r) => r.detalle?.includes(sufijo)).map((r) => r.accion);
    expect(acciones).toEqual(expect.arrayContaining(["crear_anuncio", "retirar_anuncio"]));
  });

  it("el vendedor no crea, no edita ni borra anuncios", async () => {
    await expect(db.insert(anunciosPlataforma).values({ mensaje: "colado", tipo: "info" })).rejects.toThrow();
    await expect(db.update(anunciosPlataforma).set({ retiradoTs: new Date() }).where(eq(anunciosPlataforma.id, programado))).rejects.toThrow();
    await expect(db.delete(anunciosPlataforma).where(eq(anunciosPlataforma.id, programado))).rejects.toThrow();
  });

  it("el superadmin no edita el texto ni borra, y no puede crear uno ya retirado", async () => {
    await expect(dbSuperadmin.update(anunciosPlataforma).set({ mensaje: "otro texto" }).where(eq(anunciosPlataforma.id, programado))).rejects.toThrow();
    await expect(dbSuperadmin.delete(anunciosPlataforma).where(eq(anunciosPlataforma.id, programado))).rejects.toThrow();
    await expect(dbSuperadmin.insert(anunciosPlataforma).values({ mensaje: "ya retirado", tipo: "info", retiradoTs: new Date() })).rejects.toThrow();
    // Y la base rechaza un tipo o un mensaje inválido aunque se salte la lib.
    await expect(dbSuperadmin.insert(anunciosPlataforma).values({ mensaje: "x", tipo: "otro" })).rejects.toThrow();
    await expect(dbSuperadmin.insert(anunciosPlataforma).values({ mensaje: "   ", tipo: "info" })).rejects.toThrow();
  });

  it("validación de la lib: mensaje vacío o fechas al revés", async () => {
    await expect(crearAnuncio(superadminId, { mensaje: " ", tipo: "info", desde: "", hasta: "" })).rejects.toBeInstanceOf(AnuncioInvalidoError);
    await expect(crearAnuncio(superadminId, { mensaje: "x", tipo: "info", desde: "2030-01-02T10:00", hasta: "2030-01-01T10:00" })).rejects.toBeInstanceOf(AnuncioInvalidoError);
  });
});
