import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMp } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { cifrarToken, descifrarToken } from "../lib/cifrado";
import { CuentaMpDeOtraEmpresaError, desconectarCuentaMp, guardarCuentaMpConectada } from "../lib/mp/cuentas";
import type { TokensMp } from "../lib/mp/oauth";

// Issue #422 (Bloque 1) — misma prueba que db/rls-cuentas-ml.test.ts,
// contra Postgres real: una empresa nunca ve ni toca la cuenta de
// Mercado Pago de otra.
describe("cuentas_mp (RLS, issue #422)", () => {
  let contexto: ContextoDosEmpresas;
  let cuentaAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();

    const fila = await afirmarAislamiento(contexto, cuentasMp, (tx, empresaId) =>
      tx
        .insert(cuentasMp)
        .values({
          empresaId,
          cuentaIdExterna: `mp-user-${randomUUID()}`,
          nickname: "VENDEDOR_MP_A",
          accessTokenCifrado: cifrarToken("access-de-prueba"),
          refreshTokenCifrado: cifrarToken("refresh-de-prueba"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMp.id })
    );
    cuentaAId = fila.id;
  });

  it("empresa A ve su propia cuenta conectada", async () => {
    const filas = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, cuentaAId)));
    expect(filas).toHaveLength(1);
    expect(filas[0].nickname).toBe("VENDEDOR_MP_A");
  });

  it("empresa B no ve la cuenta de empresa A", async () => {
    const filas = await dbComoEmpresa(contexto.empresaBId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, cuentaAId)));
    expect(filas).toHaveLength(0);
  });

  it("empresa B no puede actualizar la cuenta de empresa A (0 filas afectadas)", async () => {
    const actualizadas = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.update(cuentasMp).set({ nickname: "HACKEADO" }).where(eq(cuentasMp.id, cuentaAId)).returning({ id: cuentasMp.id })
    );
    expect(actualizadas).toHaveLength(0);

    const sigueIgual = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, cuentaAId)));
    expect(sigueIgual[0].nickname).toBe("VENDEDOR_MP_A");
  });

  it("no se puede conectar la misma cuenta real de Mercado Pago a dos empresas (índice único)", async () => {
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, cuentaAId)));
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(cuentasMp).values({
          empresaId: contexto.empresaBId,
          cuentaIdExterna: cuenta.cuentaIdExterna,
          nickname: "OTRA_VEZ",
          accessTokenCifrado: cifrarToken("otro-access"),
          refreshTokenCifrado: cifrarToken("otro-refresh"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
      )
    ).rejects.toThrow();
  });
});

function tokensDePrueba(cuentaIdExterna: string, sufijo: string): TokensMp {
  return { accessToken: `access-${sufijo}`, refreshToken: `refresh-${sufijo}`, expiraEnSegundos: 15_552_000, cuentaIdExterna };
}

describe("guardarCuentaMpConectada — RLS real (issue #422)", () => {
  it("reconectar la MISMA cuenta de la MISMA empresa reactiva la misma fila, nunca una nueva", async () => {
    const { empresaAId, usuarioAId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const primera = await guardarCuentaMpConectada(empresaAId, { cuentaIdExterna, nickname: "MP_INICIAL", tokens: tokensDePrueba(cuentaIdExterna, "inicial") });
    await desconectarCuentaMp(empresaAId, primera.id, usuarioAId);

    const [desconectada] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, primera.id)));
    expect(desconectada.desconectadaTs).not.toBeNull();

    const reconectada = await guardarCuentaMpConectada(empresaAId, { cuentaIdExterna, nickname: null, tokens: tokensDePrueba(cuentaIdExterna, "reconectado") });
    expect(reconectada.id).toBe(primera.id);

    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, primera.id)));
    expect(fila.desconectadaTs).toBeNull();
    // nickname null en la reconexión no pisa el que ya había.
    expect(fila.nickname).toBe("MP_INICIAL");
    expect(descifrarToken(fila.accessTokenCifrado)).toBe("access-reconectado");
  });

  it("una cuenta ya conectada a OTRA empresa: CuentaMpDeOtraEmpresaError, y la fila ajena no se toca", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const deEmpresaA = await guardarCuentaMpConectada(empresaAId, { cuentaIdExterna, nickname: "MP_A", tokens: tokensDePrueba(cuentaIdExterna, "a") });

    await expect(
      guardarCuentaMpConectada(empresaBId, { cuentaIdExterna, nickname: "INTENTO_DESDE_B", tokens: tokensDePrueba(cuentaIdExterna, "robo") })
    ).rejects.toThrow(CuentaMpDeOtraEmpresaError);

    const [filaA] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, deEmpresaA.id)));
    expect(filaA.nickname).toBe("MP_A");
    expect(descifrarToken(filaA.accessTokenCifrado)).toBe("access-a");
  });

  it("empresa B no puede desconectar la cuenta de empresa A", async () => {
    const { empresaAId, empresaBId, usuarioBId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;
    const deEmpresaA = await guardarCuentaMpConectada(empresaAId, { cuentaIdExterna, nickname: "MP_A", tokens: tokensDePrueba(cuentaIdExterna, "a") });

    await desconectarCuentaMp(empresaBId, deEmpresaA.id, usuarioBId);

    const [filaA] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMp).where(eq(cuentasMp.id, deEmpresaA.id)));
    expect(filaA.desconectadaTs).toBeNull();
  });
});
