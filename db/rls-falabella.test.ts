import { randomUUID } from "crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasFalabella, pedidosFalabella } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { CuentaFalabellaDeOtraEmpresaError, guardarCuentaConectada, listarCuentasConectadas } from "../lib/falabella/cuentas";

// Conector Falabella (15/11) — mismo criterio de aislamiento que
// cuentas_ml/pedidos (db/rls-cuentas-ml.test.ts), sin las políticas de
// transferencia/webhook (este primer corte no las necesita).

describe("cuentas_falabella / pedidos_falabella (RLS)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;
  // Revisión del PR #415: user_id es único global — un correo fijo
  // choca si la prueba corre dos veces contra la misma base local.
  const correoA = `vendedor-a-${randomUUID()}@ejemplo.com`;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const fila = await afirmarAislamiento(contexto, cuentasFalabella, (tx, empresaId) =>
      tx
        .insert(cuentasFalabella)
        .values({
          empresaId,
          userId: correoA,
          apiKeyCifrada: { version: 1, iv: "x", authTag: "y", datos: "z" },
          sellerId: "TIENDA_A",
          nickname: "Tienda A",
        })
        .returning({ id: cuentasFalabella.id })
    );
    cuentaAId = fila.id;
  });

  it("pedidos_falabella: B no ve, no edita ni borra un pedido de A", async () => {
    await afirmarAislamiento(contexto, pedidosFalabella, (tx, empresaId) =>
      tx
        .insert(pedidosFalabella)
        .values({
          empresaId,
          cuentaFalabellaId: cuentaAId,
          pedidoIdExterno: `aislamiento-${randomUUID()}`,
          fecha: new Date(),
          total: "1.00",
          moneda: "COP",
          estado: "pending",
          items: [],
        })
        .returning({ id: pedidosFalabella.id })
    );
  });

  it("la empresa B no ve la cuenta de Falabella de la empresa A", async () => {
    const vistaDesdeB = await listarCuentasConectadas(contexto.empresaBId);
    expect(vistaDesdeB.find((c) => c.id === cuentaAId)).toBeUndefined();

    const vistaDesdeA = await listarCuentasConectadas(contexto.empresaAId);
    expect(vistaDesdeA.find((c) => c.id === cuentaAId)).toBeDefined();
  });

  it("el mismo UserID no se puede conectar dos veces a empresas distintas", async () => {
    await expect(
      guardarCuentaConectada(contexto.empresaBId, {
        userId: correoA,
        apiKey: "otra-clave",
        sellerId: "TIENDA_B",
        nickname: "Tienda B",
      })
    ).rejects.toThrow(CuentaFalabellaDeOtraEmpresaError);
  });

  it("empresa B no puede insertar un pedido con el empresa_id de A", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(pedidosFalabella).values({
          empresaId: contexto.empresaAId,
          cuentaFalabellaId: cuentaAId,
          pedidoIdExterno: "9999",
          fecha: new Date(),
          total: "1.00",
          moneda: "COP",
          estado: "pending",
          items: [],
        })
      )
    ).rejects.toThrow();
  });
});
