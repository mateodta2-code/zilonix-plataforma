import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl, empresas } from "./schema";
import { cifrarToken } from "../lib/cifrado";

// Tarea 2.3 — misma prueba de siempre, contra Postgres real: una
// empresa nunca ve ni toca la cuenta de Mercado Libre de otra.
describe("cuentas_ml (RLS, tarea 2.3)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  let cuentaAId: string;

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 2.3)", nit: `TEST-A23-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 2.3)", nit: `TEST-B23-${empresaBId.slice(0, 8)}` })
    );

    const [cuenta] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-user-${randomUUID()}`,
          nickname: "VENDEDOR_A",
          accessTokenCifrado: cifrarToken("access-de-prueba"),
          refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaAId = cuenta.id;
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
