import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas, pedidos } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { obtenerProgresoOnboarding } from "./onboarding";

// Issue #323 — los 3 estados del checklist de /panel, contra Postgres
// real (RLS, como el resto de lib/, nunca un mock). Una sola empresa:
// el punto no es aislamiento A/B (ya probado en panel-kpis.test.ts),
// es que el progreso avanza en el orden correcto a medida que se
// cumple cada paso.
describe("obtenerProgresoOnboarding", () => {
  const empresaId = randomUUID();

  beforeAll(async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa onboarding", nit: `TEST-ONB-${empresaId.slice(0, 8)}` })
    );
  });

  it("sin ninguna cuenta de Mercado Libre: nada hecho todavía", async () => {
    const progreso = await obtenerProgresoOnboarding(empresaId);
    expect(progreso).toEqual({ cuentaConectada: false, pedidoVisto: false, completo: false });
  });

  it("con una cuenta conectada pero sin pedidos: falta el último paso", async () => {
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `ml-user-onb-${randomUUID()}`,
        nickname: "VENDEDOR_ONBOARDING",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );

    const progreso = await obtenerProgresoOnboarding(empresaId);
    expect(progreso).toEqual({ cuentaConectada: true, pedidoVisto: false, completo: false });
  });

  it("con un pedido ya importado: los 3 pasos quedan completos", async () => {
    const [cuenta] = await dbComoEmpresa(empresaId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.empresaId, empresaId)));
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(pedidos).values({
        empresaId,
        cuentaMlId: cuenta.id,
        pedidoIdExterno: `pedido-onb-${randomUUID()}`,
        fecha: new Date(),
        total: "100000",
        moneda: "COP",
        estado: "paid",
      })
    );

    const progreso = await obtenerProgresoOnboarding(empresaId);
    expect(progreso).toEqual({ cuentaConectada: true, pedidoVisto: true, completo: true });
  });
});

// Issue #323 — a diferencia del describe de arriba (una sola empresa,
// progreso que avanza), estos dos casos sí necesitan su propia empresa
// cada uno: aislamiento (RLS) y la cuenta desconectada no cuentan como
// "ya hecho" para ninguna otra empresa ni para la suya propia de nuevo.
describe("obtenerProgresoOnboarding — aislamiento y cuenta desconectada", () => {
  it("el progreso de la empresa A no cuenta cuentas ni pedidos de la empresa B", async () => {
    const empresaA = randomUUID();
    const empresaB = randomUUID();

    await dbComoEmpresa(empresaA, (tx) => tx.insert(empresas).values({ id: empresaA, nombre: "Empresa A", nit: `TEST-ONB-A-${empresaA.slice(0, 8)}` }));
    await dbComoEmpresa(empresaB, (tx) => tx.insert(empresas).values({ id: empresaB, nombre: "Empresa B", nit: `TEST-ONB-B-${empresaB.slice(0, 8)}` }));

    await dbComoEmpresa(empresaB, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId: empresaB,
        cuentaIdExterna: `ml-user-onb-b-${randomUUID()}`,
        nickname: "VENDEDOR_B",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
    );
    const [cuentaB] = await dbComoEmpresa(empresaB, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.empresaId, empresaB)));
    await dbComoEmpresa(empresaB, (tx) =>
      tx.insert(pedidos).values({
        empresaId: empresaB,
        cuentaMlId: cuentaB.id,
        pedidoIdExterno: `pedido-onb-b-${randomUUID()}`,
        fecha: new Date(),
        total: "100000",
        moneda: "COP",
        estado: "paid",
      })
    );

    const progresoA = await obtenerProgresoOnboarding(empresaA);
    expect(progresoA).toEqual({ cuentaConectada: false, pedidoVisto: false, completo: false });

    const progresoB = await obtenerProgresoOnboarding(empresaB);
    expect(progresoB).toEqual({ cuentaConectada: true, pedidoVisto: true, completo: true });
  });

  it("una cuenta de Mercado Libre desconectada no cuenta como paso hecho", async () => {
    const empresaId = randomUUID();
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(empresas).values({ id: empresaId, nombre: "Empresa cuenta desconectada", nit: `TEST-ONB-DESC-${empresaId.slice(0, 8)}` })
    );
    await dbComoEmpresa(empresaId, (tx) =>
      tx.insert(cuentasMl).values({
        empresaId,
        cuentaIdExterna: `ml-user-onb-desc-${randomUUID()}`,
        nickname: "VENDEDOR_DESCONECTADO",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
        desconectadaTs: new Date(),
      })
    );

    const progreso = await obtenerProgresoOnboarding(empresaId);
    expect(progreso).toEqual({ cuentaConectada: false, pedidoVisto: false, completo: false });
  });
});
