import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { cifrarToken } from "../lib/cifrado";

// Tarea 2.3 — misma prueba de siempre, contra Postgres real: una
// empresa nunca ve ni toca la cuenta de Mercado Libre de otra.
//
// Issue #39 — primer uso real de la plantilla db/test-utils/aislamiento.ts:
// crearDosEmpresas() reemplaza el armado manual de empresaA/empresaB, y
// afirmarAislamiento() ya prueba por sí sola el SELECT/UPDATE/DELETE
// genéricos (ver el archivo) — los "it" de abajo siguen siendo los
// mismos, solo que ahora confirman además el detalle propio de
// cuentas_ml (el nickname real) sobre la fila que la plantilla ya creó
// y verificó.
describe("cuentas_ml (RLS, tarea 2.3)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();

    const fila = await afirmarAislamiento(contexto, cuentasMl, (tx, empresaId) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId,
          cuentaIdExterna: `ml-user-${randomUUID()}`,
          nickname: "VENDEDOR_A",
          accessTokenCifrado: cifrarToken("access-de-prueba"),
          refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaAId = fila.id;
  });

  it("empresa A ve su propia cuenta conectada", async () => {
    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(filas).toHaveLength(1);
    expect(filas[0].nickname).toBe("VENDEDOR_A");
  });

  it("empresa B no ve la cuenta de empresa A", async () => {
    const filas = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(filas).toHaveLength(0);
  });

  it("empresa B no puede actualizar la cuenta de empresa A (0 filas afectadas)", async () => {
    const actualizadas = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(cuentasMl).set({ nickname: "HACKEADO" }).where(eq(cuentasMl.id, cuentaAId)).returning({ id: cuentasMl.id })
    );
    expect(actualizadas).toHaveLength(0);

    const sigueIgual = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(sigueIgual[0].nickname).toBe("VENDEDOR_A");
  });

  it("no se puede conectar la misma cuenta real de Mercado Libre a dos empresas (índice único)", async () => {
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(cuentasMl).values({
          empresaId: contexto.empresaBId,
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
