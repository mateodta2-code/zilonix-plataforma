import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

// Necesita Postgres real (DATABASE_URL_APP) — mismo criterio que
// lib/datos-personales.test.ts: obtenerMiMembresia pasa por
// dbComoEmpresa (RLS), nunca simulado.
const HAY_POSTGRES = Boolean(process.env.DATABASE_URL_APP);

describe.skipIf(!HAY_POSTGRES)("lib/membresias.ts — Dueño siempre con todos los permisos (caso real STOREKINGSAS/Publicidad)", () => {
  let db: (typeof import("@/db"))["db"];
  let dbComoEmpresa: (typeof import("@/db/empresa-context"))["dbComoEmpresa"];
  let usuarios: (typeof import("@/db/schema"))["usuarios"];
  let permisosRol: (typeof import("@/db/schema"))["permisosRol"];
  let crearEmpresaConDueno: (typeof import("@/lib/empresas"))["crearEmpresaConDueno"];
  let obtenerMiMembresia: (typeof import("./membresias"))["obtenerMiMembresia"];
  let tienePermiso: (typeof import("@/lib/roles"))["tienePermiso"];
  let permisosDeDueno: (typeof import("@/lib/roles-plantillas"))["permisosDeDueno"];

  beforeAll(async () => {
    ({ db } = await import("@/db"));
    ({ dbComoEmpresa } = await import("@/db/empresa-context"));
    ({ usuarios, permisosRol } = await import("@/db/schema"));
    ({ crearEmpresaConDueno } = await import("@/lib/empresas"));
    ({ obtenerMiMembresia } = await import("./membresias"));
    ({ tienePermiso } = await import("@/lib/roles"));
    ({ permisosDeDueno } = await import("@/lib/roles-plantillas"));
  });

  async function crearUsuarioDePrueba() {
    const [usuario] = await db.insert(usuarios).values({ email: `prueba-membresias-${randomUUID()}@zilonix.test`, nombre: "Dueño de prueba" }).returning();
    return usuario;
  }

  it("rol Dueño con MENOS filas en permisos_rol que el matriz completo (caso real: módulo agregado después de crear la empresa) -> obtenerMiMembresia igual devuelve TODO", async () => {
    const usuario = await crearUsuarioDePrueba();
    const empresaId = await crearEmpresaConDueno(usuario.id, "Empresa de prueba Dueño", `TEST-DUENO-${randomUUID().slice(0, 8)}`);

    // Simula el caso real: una empresa vieja, creada antes de que
    // "publicidad" y "promociones" existieran en MODULOS — se borran
    // esas filas de permisos_rol para dejar el Dueño con MENOS de lo
    // que permisosDeDueno() calcula hoy.
    const { rolId } = (await obtenerMiMembresia(usuario.id, empresaId))!;
    await dbComoEmpresa(empresaId, (tx) => tx.delete(permisosRol).where(eq(permisosRol.rolId, rolId)));

    const miMembresia = await obtenerMiMembresia(usuario.id, empresaId);
    expect(miMembresia?.rolNombre).toBe("Dueño");
    // Sin ninguna fila real en la base, igual tiene TODOS los permisos
    // de permisosDeDueno() — nunca depende de lo guardado.
    expect(miMembresia?.permisos).toHaveLength(permisosDeDueno().length);
    expect(tienePermiso(miMembresia!.permisos, "publicidad", "consultar")).toBe(true);
    expect(tienePermiso(miMembresia!.permisos, "promociones", "ejecutar")).toBe(true);
  });

  it("rol que NO es Dueño sigue dependiendo de sus propias filas de permisos_rol (nunca se le regala nada)", async () => {
    const usuario = await crearUsuarioDePrueba();
    const empresaId = await crearEmpresaConDueno(usuario.id, "Empresa de prueba no-Dueño", `TEST-NODUENO-${randomUUID().slice(0, 8)}`);
    const { roles, membresias } = await import("@/db/schema");
    const otraPersona = await crearUsuarioDePrueba();
    const [rolOperador] = await dbComoEmpresa(empresaId, (tx) => tx.insert(roles).values({ nombre: "Operador", empresaId }).returning({ id: roles.id }));
    await dbComoEmpresa(empresaId, (tx) => tx.insert(membresias).values({ usuarioId: otraPersona.id, empresaId, rolId: rolOperador.id }));

    const miMembresia = await obtenerMiMembresia(otraPersona.id, empresaId);
    expect(miMembresia?.rolNombre).toBe("Operador");
    expect(miMembresia?.permisos).toEqual([]);
    expect(tienePermiso(miMembresia!.permisos, "publicidad", "consultar")).toBe(false);
  });
});
