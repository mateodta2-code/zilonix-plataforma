import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { cifrarToken } from "../lib/cifrado";
import { dbComoEmpresaYUsuario } from "./empresa-context";
import { db } from "./index";
import { canvaConexiones, usuarios } from "./schema";
import { crearDosEmpresas } from "./test-utils/aislamiento";

// canva_conexiones es la primera tabla que filtra por empresa_id Y
// usuario_id a la vez (pedido explícito de Pablo/Mateo: una persona
// nunca ve la conexión de Canva de otra persona, aunque esté en la
// MISMA empresa) — por eso no usa la plantilla genérica
// afirmarAislamiento() de test-utils/aislamiento.ts (pensada para
// "empresa A vs empresa B", un solo usuario por lado) y se prueba a
// mano, contra Postgres real (RLS no se simula, regla de CLAUDE.md).

async function crearUsuario(etiqueta: string): Promise<string> {
  const [usuario] = await db
    .insert(usuarios)
    .values({ email: `prueba-canva-${etiqueta}-${randomUUID()}@zilonix.test`, nombre: `Usuario Canva ${etiqueta} (prueba)` })
    .returning({ id: usuarios.id });
  return usuario.id;
}

async function crearConexion(empresaId: string, usuarioId: string) {
  const [fila] = await dbComoEmpresaYUsuario(empresaId, usuarioId, (tx) =>
    tx
      .insert(canvaConexiones)
      .values({
        empresaId,
        usuarioId,
        accessTokenCifrado: cifrarToken("access-de-prueba"),
        refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: canvaConexiones.id })
  );
  return fila;
}

describe("canva_conexiones (RLS por empresa Y usuario)", () => {
  it("usuario B de la MISMA empresa no ve, edita ni borra la conexión de usuario A; A sí sigue viéndola", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const usuarioAId = await crearUsuario("a");
    const usuarioBId = await crearUsuario("b-misma-empresa");

    const filaA = await crearConexion(empresaAId, usuarioAId);

    const veB = await dbComoEmpresaYUsuario(empresaAId, usuarioBId, (tx) =>
      tx.select({ id: canvaConexiones.id }).from(canvaConexiones).where(eq(canvaConexiones.id, filaA.id))
    );
    expect(veB, "usuario B no debería ver la conexión de usuario A, aunque esté en la misma empresa").toHaveLength(0);

    const editaB = await dbComoEmpresaYUsuario(empresaAId, usuarioBId, (tx) =>
      tx.update(canvaConexiones).set({ desconectadaTs: new Date() }).where(eq(canvaConexiones.id, filaA.id)).returning({ id: canvaConexiones.id })
    );
    expect(editaB, "usuario B no debería poder editar la conexión de usuario A (UPDATE)").toHaveLength(0);

    // Desconectar nunca borra la fila (decisión explícita, ver
    // db/schema.ts) — app_user no tiene GRANT de DELETE en esta tabla
    // (db/rls-setup.sql), así que un DELETE falla por permiso, nunca
    // por RLS, igual que promociones_reglas/candidatos/acciones
    // (db/rls-promociones.test.ts).
    await expect(
      dbComoEmpresaYUsuario(empresaAId, usuarioAId, (tx) => tx.delete(canvaConexiones).where(eq(canvaConexiones.id, filaA.id)))
    ).rejects.toThrow(/permission denied/);

    const veA = await dbComoEmpresaYUsuario(empresaAId, usuarioAId, (tx) =>
      tx.select({ id: canvaConexiones.id }).from(canvaConexiones).where(eq(canvaConexiones.id, filaA.id))
    );
    expect(veA, "usuario A sí debería seguir viendo su propia conexión").toHaveLength(1);
  });

  it("empresa B nunca ve la conexión de empresa A, ni adivinando el mismo usuario_id", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const usuarioId = await crearUsuario("cruzado-entre-empresas");

    const filaA = await crearConexion(empresaAId, usuarioId);

    const veDesdeB = await dbComoEmpresaYUsuario(empresaBId, usuarioId, (tx) =>
      tx.select({ id: canvaConexiones.id }).from(canvaConexiones).where(eq(canvaConexiones.id, filaA.id))
    );
    expect(veDesdeB, "empresa B no debería ver la conexión de empresa A, aunque pase el mismo usuario_id").toHaveLength(0);
  });

  it("una sola conexión por (empresa, usuario) — una segunda fila para el mismo par viola el unique", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const usuarioId = await crearUsuario("unica-por-par");

    await crearConexion(empresaAId, usuarioId);

    await expect(crearConexion(empresaAId, usuarioId)).rejects.toThrow();
  });
});
