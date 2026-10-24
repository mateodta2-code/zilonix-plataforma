import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { empresas, seguimientosMl, usuarios } from "@/db/schema";
import { contarCompetidoresActivos, LIMITE_COMPETIDORES_POR_EMPRESA, LimiteCompetidoresError, verificarCupoCompetidor } from "./seguimientos";

async function crearEmpresaConUsuario() {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa de prueba", nit: `TEST-SEG-${empresaId.slice(0, 8)}` }));
  const [usuario] = await dbComoEmpresa(empresaId, (tx) => tx.insert(usuarios).values({ email: `prueba-seguimiento-${empresaId}@zilonix.test`, nombre: "Usuario de prueba" }).returning({ id: usuarios.id }));
  return { empresaId, usuarioId: usuario.id };
}

async function crearSeguimiento(empresaId: string, usuarioId: string, esCompetidor: boolean) {
  await dbComoEmpresa(empresaId, (tx) =>
    tx.insert(seguimientosMl).values({
      empresaId,
      tipo: "producto",
      recursoMl: "item",
      mlIdExterno: `MCO${randomUUID().replace(/-/g, "").slice(0, 10)}`,
      nombre: "Producto de prueba",
      linkOriginal: "https://articulo.mercadolibre.com.co/MCO-1",
      esCompetidor,
      creadoPor: usuarioId,
    })
  );
}

// Issue #175 — "máximo 5 competidores por empresa, validado en el
// servidor". Contra Postgres real (no un mock): dbComoEmpresa exige
// una conexión real, igual que el resto de las pruebas de este repo.
describe("verificarCupoCompetidor / contarCompetidoresActivos (issue #175)", () => {
  it("cuenta solo los marcados como competidor, nunca los demás seguimientos", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    await crearSeguimiento(empresaId, usuarioId, true);
    await crearSeguimiento(empresaId, usuarioId, false);
    await crearSeguimiento(empresaId, usuarioId, false);

    expect(await contarCompetidoresActivos(empresaId)).toBe(1);
  });

  it(`deja agregar hasta ${LIMITE_COMPETIDORES_POR_EMPRESA}, el sexto lanza LimiteCompetidoresError`, async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_COMPETIDORES_POR_EMPRESA; i++) {
      await expect(verificarCupoCompetidor(empresaId)).resolves.toBeUndefined();
      await crearSeguimiento(empresaId, usuarioId, true);
    }
    expect(await contarCompetidoresActivos(empresaId)).toBe(LIMITE_COMPETIDORES_POR_EMPRESA);
    await expect(verificarCupoCompetidor(empresaId)).rejects.toThrow(LimiteCompetidoresError);
  });

  it("quitar un competidor (eliminado_ts) libera cupo real", async () => {
    const { empresaId, usuarioId } = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_COMPETIDORES_POR_EMPRESA; i++) await crearSeguimiento(empresaId, usuarioId, true);
    await expect(verificarCupoCompetidor(empresaId)).rejects.toThrow(LimiteCompetidoresError);

    const [unCompetidor] = await dbComoEmpresa(empresaId, (tx) => tx.select({ id: seguimientosMl.id }).from(seguimientosMl).limit(1));
    await dbComoEmpresa(empresaId, (tx) => tx.update(seguimientosMl).set({ eliminadoTs: new Date() }).where(eq(seguimientosMl.id, unCompetidor.id)));

    expect(await contarCompetidoresActivos(empresaId)).toBe(LIMITE_COMPETIDORES_POR_EMPRESA - 1);
    await expect(verificarCupoCompetidor(empresaId)).resolves.toBeUndefined();
  });

  it("el límite es por empresa: otra empresa con 5 competidores no afecta a esta", async () => {
    const otra = await crearEmpresaConUsuario();
    for (let i = 0; i < LIMITE_COMPETIDORES_POR_EMPRESA; i++) await crearSeguimiento(otra.empresaId, otra.usuarioId, true);

    const { empresaId } = await crearEmpresaConUsuario();
    expect(await contarCompetidoresActivos(empresaId)).toBe(0);
    await expect(verificarCupoCompetidor(empresaId)).resolves.toBeUndefined();
  });
});
