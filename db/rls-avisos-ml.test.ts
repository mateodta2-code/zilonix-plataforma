import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl, empresas, avisosMl } from "./schema";
import { cifrarToken } from "../lib/cifrado";
import { recibirAviso } from "../lib/ml/avisos";

// Tarea 2.4 (adelanto parcial) — prueba real: un aviso con el user_id
// de una cuenta conectada se guarda en la empresa correcta; uno de una
// cuenta desconocida se descarta; el mismo aviso repetido (ML reintenta)
// no se duplica; y el aislamiento normal entre empresas sigue intacto.
describe("recepción de avisos de Mercado Libre (tarea 2.4)", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const cuentaExternaA = `ml-user-${randomUUID()}`;

  beforeAll(async () => {
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(empresas).values({ id: empresaAId, nombre: "Empresa A (prueba 2.4)", nit: `TEST-A24-${empresaAId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaBId, (tx) =>
      tx.insert(empresas).values({ id: empresaBId, nombre: "Empresa B (prueba 2.4)", nit: `TEST-B24-${empresaBId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaAId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId: empresaAId,
        cuentaIdExterna: cuentaExternaA,
        nickname: "VENDEDOR_A",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );
  });

  it("un aviso de una cuenta conectada se guarda en la empresa correcta", async () => {
    const resultado = await recibirAviso({
      resource: "/orders/123",
      user_id: cuentaExternaA,
      topic: "orders_v2",
      sent: "2026-10-20T10:00:00.000Z",
    });
    expect(resultado).toBe("guardado");

    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/orders/123")));
    expect(filas).toHaveLength(1);
    expect(filas[0].procesadoTs).toBeNull();
  });

  it("empresa B nunca ve el aviso de empresa A", async () => {
    const filas = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/orders/123")));
    expect(filas).toHaveLength(0);
  });

  it("el mismo aviso exacto reintentado por Mercado Libre no se duplica", async () => {
    const resultado = await recibirAviso({
      resource: "/orders/123",
      user_id: cuentaExternaA,
      topic: "orders_v2",
      sent: "2026-10-20T10:00:00.000Z", // mismo "sent" exacto = el mismo aviso
    });
    expect(resultado).toBe("duplicado");

    const filas = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(avisosMl).where(eq(avisosMl.resource, "/orders/123")));
    expect(filas).toHaveLength(1); // sigue siendo uno solo
  });

  it("un aviso de una cuenta que no está conectada a ninguna empresa se descarta sin reventar", async () => {
    const resultado = await recibirAviso({
      resource: "/orders/999",
      user_id: `cuenta-no-conectada-${randomUUID()}`,
      topic: "orders_v2",
      sent: "2026-10-20T10:05:00.000Z",
    });
    expect(resultado).toBe("cuenta_desconocida");
  });
});
