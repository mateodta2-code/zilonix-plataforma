import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMp, pagosMpPorCobrar } from "./schema";
import { crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { cifrarToken } from "../lib/cifrado";

// Issue #422 (por cobrar) — misma idea que db/rls-cuentas-mp.test.ts,
// contra Postgres real: una empresa nunca ve, borra ni cuelga pagos de la
// cuenta de Mercado Pago de otra. app_user no tiene UPDATE en esta tabla
// (la foto se reemplaza con DELETE + INSERT), así que no se usa
// afirmarAislamiento (que prueba un UPDATE).
describe("pagos_mp_por_cobrar (RLS, issue #422)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;
  let pagoAId: string;

  const pagoDe = (empresaId: string, cuentaMpId: string, extra: Partial<typeof pagosMpPorCobrar.$inferInsert> = {}) => ({
    empresaId,
    cuentaMpId,
    pagoIdExterno: `pago-${randomUUID()}`,
    estado: "approved",
    estadoLiberacion: "pending",
    montoNeto: "95000.50",
    moneda: "COP",
    tipo: "por_liberar",
    ...extra,
  });

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasMp)
        .values({
          empresaId: contexto.empresaAId,
          cuentaIdExterna: `mp-user-${randomUUID()}`,
          nickname: "VENDEDOR_MP_A",
          accessTokenCifrado: cifrarToken("access-de-prueba"),
          refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMp.id })
    );
    cuentaAId = cuenta.id;
    const [pago] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(pagosMpPorCobrar).values(pagoDe(contexto.empresaAId, cuentaAId)).returning({ id: pagosMpPorCobrar.id })
    );
    pagoAId = pago.id;
  });

  it("empresa A ve su propio pago", async () => {
    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(pagosMpPorCobrar).where(eq(pagosMpPorCobrar.id, pagoAId)));
    expect(filas).toHaveLength(1);
    expect(filas[0].montoNeto).toBe("95000.50");
  });

  it("empresa B no ve ni borra el pago de empresa A", async () => {
    const ve = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(pagosMpPorCobrar).where(eq(pagosMpPorCobrar.id, pagoAId)));
    expect(ve).toHaveLength(0);

    const borradas = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.delete(pagosMpPorCobrar).where(eq(pagosMpPorCobrar.id, pagoAId)).returning({ id: pagosMpPorCobrar.id })
    );
    expect(borradas).toHaveLength(0);

    const sigue = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(pagosMpPorCobrar).where(eq(pagosMpPorCobrar.id, pagoAId)));
    expect(sigue).toHaveLength(1);
  });

  it("empresa B no puede colgar un pago de la cuenta de empresa A (RLS + FK compuesta)", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) => tx.insert(pagosMpPorCobrar).values(pagoDe(contexto.empresaBId, cuentaAId)))
    ).rejects.toThrow();
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) => tx.insert(pagosMpPorCobrar).values(pagoDe(contexto.empresaAId, cuentaAId)))
    ).rejects.toThrow();
  });

  it("nadie edita una fila (sin UPDATE): la foto se reemplaza", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.update(pagosMpPorCobrar).set({ montoNeto: "1.00" }).where(eq(pagosMpPorCobrar.id, pagoAId)))
    ).rejects.toThrow(/permission denied/);
  });

  it("moneda ISO, tipo válido y un pago por cuenta", async () => {
    const insertar = (extra: Partial<typeof pagosMpPorCobrar.$inferInsert>) =>
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.insert(pagosMpPorCobrar).values(pagoDe(contexto.empresaAId, cuentaAId, extra)));
    await expect(insertar({ moneda: "cop" })).rejects.toThrow();
    await expect(insertar({ tipo: "otro" })).rejects.toThrow();
    const [existente] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(pagosMpPorCobrar).where(eq(pagosMpPorCobrar.id, pagoAId)));
    await expect(insertar({ pagoIdExterno: existente.pagoIdExterno })).rejects.toThrow();
  });

  it("empresa A borra su propia foto", async () => {
    const borradas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.delete(pagosMpPorCobrar).where(eq(pagosMpPorCobrar.cuentaMpId, cuentaAId)).returning({ id: pagosMpPorCobrar.id })
    );
    expect(borradas.map((b) => b.id)).toContain(pagoAId);
  });
});
