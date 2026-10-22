import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl } from "./schema";
import { cifrarToken } from "../lib/cifrado";
import { afirmarAislamiento } from "./test-utils/aislamiento";

// Tarea 2.3 — misma prueba de siempre, contra Postgres real: una
// empresa nunca ve ni toca la cuenta de Mercado Libre de otra.
// Z-MT-09: el alta de las dos empresas y el "B no ve / no edita / no
// borra / no inserta con empresa_id de A" pasan por
// db/test-utils/aislamiento.ts. Las comprobaciones de abajo quedan
// iguales. El insert ajeno no es genérico: nickname, tokens y
// cuenta_id_externa son obligatorios, y un NOT NULL no demostraría el
// WITH CHECK — por eso el test arma esa fila explícita, con otra
// cuenta externa (si no, la rechazaría el índice único).
describe("cuentas_ml (RLS, tarea 2.3)", () => {
  let empresaAId: string;
  let empresaBId: string;
  let cuentaAId: string;

  beforeAll(async () => {
    const ctx = await afirmarAislamiento(
      cuentasMl,
      async ({ empresaAId: idA }) => {
        const [cuenta] = await dbComoEmpresa(idA, (tx) =>
          tx
            .insert(cuentasMl)
            .values({
              empresaId: idA,
              cuentaIdExterna: `ml-user-${randomUUID()}`,
              nickname: "VENDEDOR_A",
              accessTokenCifrado: cifrarToken("access-de-prueba"),
              refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
              tokenExpiraTs: new Date(Date.now() + 3600_000),
            })
            .returning({ id: cuentasMl.id })
        );
        // Misma columna que el test de "no puede actualizar" de abajo
        // (nickname → "HACKEADO"): la plantilla y ese it pisan el mismo
        // campo, así el resultado de la tarea 2.3 no cambia.
        return { id: cuenta.id, columna: cuentasMl.nickname, valorAjeno: "HACKEADO" };
      },
      () => ({
        cuentaIdExterna: `ml-user-ajeno-${randomUUID()}`,
        nickname: "INTENTO_B_SOBRE_A",
        accessTokenCifrado: cifrarToken("access-ajeno"),
        refreshTokenCifrado: cifrarToken("refresh-ajeno"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );
    empresaAId = ctx.empresaAId;
    empresaBId = ctx.empresaBId;
    cuentaAId = ctx.filaId;
  });

  it("empresa A ve su propia cuenta conectada", async () => {
    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(filas).toHaveLength(1);
    expect(filas[0].nickname).toBe("VENDEDOR_A");
  });

  it("empresa B no ve la cuenta de empresa A", async () => {
    const filas = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(filas).toHaveLength(0);
  });

  it("empresa B no puede actualizar la cuenta de empresa A (0 filas afectadas)", async () => {
    const actualizadas = await dbComoEmpresa(empresaBId, (tx) =>
      tx.update(cuentasMl).set({ nickname: "HACKEADO" }).where(eq(cuentasMl.id, cuentaAId)).returning({ id: cuentasMl.id })
    );
    expect(actualizadas).toHaveLength(0);

    const sigueIgual = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(sigueIgual[0].nickname).toBe("VENDEDOR_A");
  });

  it("no se puede conectar la misma cuenta real de Mercado Libre a dos empresas (índice único)", async () => {
    const [cuenta] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    await expect(
      dbComoEmpresa(empresaBId, (tx) =>
        tx.insert(cuentasMl).values({
          empresaId: empresaBId,
          cuentaIdExterna: cuenta.cuentaIdExterna, // misma cuenta externa que ya usa empresa A
          nickname: "VENDEDOR_A_OTRA_VEZ",
          accessTokenCifrado: cifrarToken("otro-access"),
          refreshTokenCifrado: cifrarToken("otro-refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
      )
    ).rejects.toThrow();
  });
});
