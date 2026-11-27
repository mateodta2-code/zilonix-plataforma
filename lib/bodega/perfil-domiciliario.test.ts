import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dbComoUsuarioBodega } from "@/db/bodega-context";
import { db } from "@/db";
import { auditoria, perfilesDomiciliario, usuarios } from "@/db/schema";
import { contadorPorIp, contadorPorUsuario, crearPerfilDomiciliario, frenarAutorregistroDomiciliario, PerfilDomiciliarioError, tienePerfilDomiciliario } from "./perfil-domiciliario";

describe("límite del autorregistro de domiciliario", () => {
  it("frena al usuario a la sexta vez en la hora y al IP a la vigésima primera", () => {
    contadorPorUsuario.clear();
    contadorPorIp.clear();
    const u = randomUUID();
    for (let i = 0; i < 5; i++) frenarAutorregistroDomiciliario(u, `ip-${i}`);
    expect(() => frenarAutorregistroDomiciliario(u, "ip-x")).toThrow(PerfilDomiciliarioError);
    for (let i = 0; i < 20; i++) frenarAutorregistroDomiciliario(randomUUID(), "misma-ip");
    expect(() => frenarAutorregistroDomiciliario(randomUUID(), "misma-ip")).toThrow(PerfilDomiciliarioError);
  });
});

// Contra Postgres real (RLS): perfil + auditoría y aislamiento entre personas.
describe("crearPerfilDomiciliario", () => {
  const sufijo = randomUUID().slice(0, 8);
  const ana = randomUUID();
  const beto = randomUUID();
  const vendedora = randomUUID();

  const clienteDueno = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
  const dbDueno = drizzle(clienteDueno);
  afterAll(async () => {
    await clienteDueno.end();
  });

  beforeAll(async () => {
    await db.insert(usuarios).values([
      { id: ana, email: `perfil-ana-${sufijo}@zilonix.test`, nombre: "Ana" },
      { id: beto, email: `perfil-beto-${sufijo}@zilonix.test`, nombre: "Beto" },
      { id: vendedora, email: `perfil-vend-${sufijo}@zilonix.test`, nombre: "Vendedora" },
    ]);
  });

  it("camino feliz: crea el perfil y una fila de auditoría sin el teléfono en claro", async () => {
    const { id } = await crearPerfilDomiciliario(ana, { nombre: "  Ana Pérez ", telefono: "3001234567", ciudad: "Bogotá" });
    expect(await tienePerfilDomiciliario(ana)).toBe(true);
    const [perfil] = await dbComoUsuarioBodega(ana, (tx) => tx.select().from(perfilesDomiciliario).where(eq(perfilesDomiciliario.id, id)));
    expect(perfil).toMatchObject({ nombre: "Ana Pérez", telefono: "3001234567", ciudad: "Bogotá" });
    // Se lee con la conexión de dueño: app_user sin empresa ni bodega no puede
    // consultar auditoria (aislamiento_auditoria castea app.empresa_id vacío a uuid).
    const aud = await dbDueno.select().from(auditoria).where(and(eq(auditoria.entidad, "perfil_domiciliario"), eq(auditoria.entidadId, id)));
    expect(aud).toHaveLength(1);
    expect(aud[0]).toMatchObject({ accion: "domiciliario_autorregistro", actorTipo: "persona", bodegaId: null, empresaId: null, usuarioId: ana });
    expect(aud[0].detalle ?? "").not.toContain("3001234567");
  });

  it("si ya tiene perfil, no crea otro", async () => {
    await expect(crearPerfilDomiciliario(ana, { nombre: "Otra vez" })).rejects.toBeInstanceOf(PerfilDomiciliarioError);
  });

  it("nadie lee el perfil de otro", async () => {
    expect(await tienePerfilDomiciliario(beto)).toBe(false);
    const ajenos = await dbComoUsuarioBodega(beto, (tx) => tx.select().from(perfilesDomiciliario).where(eq(perfilesDomiciliario.usuarioId, ana)));
    expect(ajenos).toHaveLength(0);
  });

  it("una cuenta que ya es vendedora (otro papel) también crea su perfil con el mismo usuario", async () => {
    await expect(crearPerfilDomiciliario(vendedora, { nombre: "Vendedora Domi" })).resolves.toHaveProperty("id");
    expect(await tienePerfilDomiciliario(vendedora)).toBe(true);
  });

  it("el nombre es obligatorio y nada queda a medias", async () => {
    await expect(crearPerfilDomiciliario(beto, { nombre: "   " })).rejects.toBeInstanceOf(PerfilDomiciliarioError);
    expect(await tienePerfilDomiciliario(beto)).toBe(false);
  });
});
