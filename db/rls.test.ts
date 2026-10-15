import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { db } from "./index";
import { empresas, membresias, roles, usuarios } from "./schema";

// Tarea 1.4 — la prueba real que confirma que la tarea 1.3 (RLS)
// funciona de verdad, no solo que "no dio error al escribirla". Corre
// contra una base Postgres de verdad con app_user y las políticas ya
// activas (en CI, un Postgres efímero preparado para esto — ver
// .github/workflows/ci.yml) — una base simulada no sirve, RLS es una
// protección que vive en Postgres mismo, no se puede probar con un
// mock.
//
// Para correrla en tu máquina hace falta un Postgres local con
// db/migrations/ y db/rls-setup.sql ya aplicados, y DATABASE_URL_APP
// apuntando a ese Postgres con el usuario app_user.

describe("aislamiento entre empresas (RLS)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 1.4)", nit: `TEST-A-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 1.4)", nit: `TEST-B-${empresaBId.slice(0, 8)}` })
    );
  });

  it("una empresa SÍ puede ver su propia fila", async () => {
    const propia = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(empresas).where(eq(empresas.id, empresaAId)));
    expect(propia).toHaveLength(1);
    expect(propia[0].nombre).toBe("Empresa A (prueba 1.4)");
  });

  it("empresa A no puede LEER la fila de empresa B", async () => {
    const vistas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(empresas).where(eq(empresas.id, empresaBId)));
    expect(vistas).toHaveLength(0);
  });

  it("empresa A no puede EDITAR la fila de empresa B", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.update(empresas).set({ nombre: "hackeado" }).where(eq(empresas.id, empresaBId)));
    const real = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(empresas).where(eq(empresas.id, empresaBId)));
    expect(real[0].nombre).toBe("Empresa B (prueba 1.4)");
  });

  it("empresa A no puede BORRAR la fila de empresa B", async () => {
    await dbComoEmpresa(empresaAId, (tx) => tx.delete(empresas).where(eq(empresas.id, empresaBId)));
    const sigueViva = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(empresas).where(eq(empresas.id, empresaBId)));
    expect(sigueViva).toHaveLength(1);
  });

  it("sin empresa activa (contexto vacío) no se ve ninguna fila — cerrado por defecto", async () => {
    // Consulta directa, sin pasar por dbComoEmpresa(): nunca se fijó
    // app.empresa_actual, así que la política no deja ver nada.
    const nada = await db.select().from(empresas).where(eq(empresas.id, empresaAId));
    expect(nada).toHaveLength(0);
  });

  describe("mismo aislamiento en una tabla con empresa_id (no solo en empresas)", () => {
    const rolAId = randomUUID();
    const usuarioId = randomUUID();

    beforeAll(async () => {
      // roles.empresa_id no está cubierto por la política "id = propia
      // empresa" de la tabla empresas — usa su propia política
      // (empresa_id = propia empresa O plantilla). Se prueba acá para
      // confirmar que el mecanismo generaliza, no es un caso especial
      // de una sola tabla.
      await dbComoEmpresa(empresaAId, (tx) => tx.insert(roles).values({ id: rolAId, nombre: "Rol propio de A", empresaId: empresaAId }));
      // usuarios no lleva RLS a propósito (puede estar en varias
      // empresas) — se inserta directo, sin dbComoEmpresa.
      await db.insert(usuarios).values({ id: usuarioId, email: `prueba-${usuarioId.slice(0, 8)}@zilonix.test`, nombre: "Usuario de prueba" });
    });

    it("empresa B no ve el rol propio de empresa A", async () => {
      const vistos = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(roles).where(eq(roles.id, rolAId)));
      expect(vistos).toHaveLength(0);
    });

    it("empresa B no puede crear una membresía apuntando a empresa A", async () => {
      // Intenta crear una membresía con empresaId = A mientras el
      // contexto activo es B — la política exige que coincidan, así
      // que el insert debe fallar (no silenciarse).
      await expect(
        dbComoEmpresa(empresaBId, (tx) =>
          tx.insert(membresias).values({ id: randomUUID(), usuarioId, empresaId: empresaAId, rolId: rolAId })
        )
      ).rejects.toThrow();
    });

    it("empresa A SÍ puede crear su propia membresía", async () => {
      const membresiaId = randomUUID();
      await dbComoEmpresa(empresaAId, (tx) => tx.insert(membresias).values({ id: membresiaId, usuarioId, empresaId: empresaAId, rolId: rolAId }));
      const vista = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(membresias).where(eq(membresias.id, membresiaId)));
      expect(vista).toHaveLength(1);
    });
  });
});
