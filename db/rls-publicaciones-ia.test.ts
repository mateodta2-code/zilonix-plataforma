import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { publicacionesIaImagenes, publicacionesIaTrabajos } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// Publicar → «Crear con IA» (PR2) — el historial de imágenes de una
// empresa nunca lo ve ni lo edita otra. Contra Postgres real (RLS no se
// simula). Sin afirmarAislamiento(): app_user no tiene DELETE en estas
// tablas (el historial no se borra), así que se prueba a mano, como
// db/rls-promociones.test.ts.

async function crearTrabajo(empresaId: string) {
  const [trabajo] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(publicacionesIaTrabajos)
      .values({ empresaId, siteId: "MCO", estilo: "zilonix_portadas", ficha: { nombre: { valor: "Termo", origen: "vendedor" } }, proveedor: "openai", modelo: "gpt-image-1" })
      .returning({ id: publicacionesIaTrabajos.id })
  );
  return trabajo.id;
}

describe("publicaciones_ia_trabajos / publicaciones_ia_imagenes (RLS)", () => {
  it("empresa B no ve ni edita el trabajo ni las imágenes de A; A sí; DELETE falla", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const trabajoA = await crearTrabajo(empresaAId);
    const [imagenA] = await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(publicacionesIaImagenes).values({ empresaId: empresaAId, trabajoId: trabajoA, tipo: "portada", estado: "aprobada" }).returning({ id: publicacionesIaImagenes.id })
    );

    expect(await dbComoEmpresa(empresaBId, (tx) => tx.select().from(publicacionesIaTrabajos).where(eq(publicacionesIaTrabajos.id, trabajoA)))).toHaveLength(0);
    expect(await dbComoEmpresa(empresaBId, (tx) => tx.select().from(publicacionesIaImagenes).where(eq(publicacionesIaImagenes.id, imagenA.id)))).toHaveLength(0);
    const editadasPorB = await dbComoEmpresa(empresaBId, (tx) =>
      tx.update(publicacionesIaImagenes).set({ estado: "error" }).where(eq(publicacionesIaImagenes.id, imagenA.id)).returning({ id: publicacionesIaImagenes.id })
    );
    expect(editadasPorB).toHaveLength(0);

    const editadasPorA = await dbComoEmpresa(empresaAId, (tx) =>
      tx.update(publicacionesIaImagenes).set({ estado: "generando" }).where(eq(publicacionesIaImagenes.id, imagenA.id)).returning({ estado: publicacionesIaImagenes.estado })
    );
    expect(editadasPorA).toEqual([{ estado: "generando" }]);

    await expect(dbComoEmpresa(empresaAId, (tx) => tx.delete(publicacionesIaImagenes).where(eq(publicacionesIaImagenes.id, imagenA.id)))).rejects.toThrow(/permission denied/);
  });

  it("B no puede colgar una imagen de un trabajo de A (FK compuesta por empresa)", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const trabajoA = await crearTrabajo(empresaAId);
    await expect(
      dbComoEmpresa(empresaBId, (tx) => tx.insert(publicacionesIaImagenes).values({ empresaId: empresaBId, trabajoId: trabajoA, tipo: "portada" }))
    ).rejects.toThrow();
  });

  it("estados, estilos y URL https validados en la base", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const trabajoA = await crearTrabajo(empresaAId);
    await expect(dbComoEmpresa(empresaAId, (tx) => tx.insert(publicacionesIaImagenes).values({ empresaId: empresaAId, trabajoId: trabajoA, tipo: "portada", estado: "inventado" }))).rejects.toThrow();
    await expect(
      dbComoEmpresa(empresaAId, (tx) => tx.insert(publicacionesIaImagenes).values({ empresaId: empresaAId, trabajoId: trabajoA, tipo: "portada", urlCloudinary: "http://inseguro.com/a.png" }))
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(empresaAId, (tx) =>
        tx.insert(publicacionesIaTrabajos).values({ empresaId: empresaAId, siteId: "MCO", estilo: "otro", ficha: {}, proveedor: "openai", modelo: "m" })
      )
    ).rejects.toThrow();
  });
});
