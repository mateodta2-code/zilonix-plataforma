import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { cuentasMl } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { cifrarToken, descifrarToken } from "../lib/cifrado";
import {
  CuentaMlDeOtraEmpresaError,
  desconectarCuenta,
  guardarCuentaConectada,
  obtenerEmpresaDueñaDeCuentaMl,
  transferirCuentaMlAOtraEmpresa,
} from "../lib/ml/cuentas";
import type { TokensMl } from "../lib/ml/oauth";

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

function tokensDePrueba(cuentaIdExterna: string, sufijo: string): TokensMl {
  return { accessToken: `access-${sufijo}`, refreshToken: `refresh-${sufijo}`, expiraEnSegundos: 21_600, cuentaIdExterna };
}

// Bug real en vivo en staging: reconectar una cuenta de Mercado Libre
// reventaba con "duplicate key value violates unique constraint
// cuentas_ml_cuenta_externa_unica". A diferencia de las pruebas de
// arriba (que insertan directo con tx.insert para probar el índice en
// sí), estas pasan por guardarCuentaConectada de verdad — el
// comportamiento real bajo RLS a FORCE (ver db/rls-setup.sql) solo se
// puede confirmar contra Postgres real, nunca con un mock.
describe("guardarCuentaConectada — RLS real (issue reconectar, tarea 2.3)", () => {
  it("reconectar la MISMA cuenta de la MISMA empresa (conectada o desconectada) reactiva la misma fila, nunca una nueva", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const primera = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_INICIAL",
      tokens: tokensDePrueba(cuentaIdExterna, "inicial"),
      siteId: null,
    });
    await desconectarCuenta(empresaAId, primera.id);

    const reconectada = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_RECONECTADO",
      tokens: tokensDePrueba(cuentaIdExterna, "reconectado"),
      siteId: null,
    });

    expect(reconectada.id).toBe(primera.id);
    const [fila] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, primera.id)));
    expect(fila.desconectadaTs).toBeNull();
    expect(fila.nickname).toBe("VENDEDOR_RECONECTADO");
    expect(descifrarToken(fila.accessTokenCifrado)).toBe("access-reconectado");

    const todas = await dbComoEmpresa(empresaAId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna)));
    expect(todas).toHaveLength(1);
  });

  it("una cuenta ya conectada a OTRA empresa: CuentaMlDeOtraEmpresaError de verdad bajo RLS a FORCE, y la fila ajena no se toca", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });

    await expect(
      guardarCuentaConectada(empresaBId, {
        cuentaIdExterna,
        nickname: "INTENTO_DESDE_B",
        tokens: tokensDePrueba(cuentaIdExterna, "robo"),
        siteId: null,
      })
    ).rejects.toThrow(CuentaMlDeOtraEmpresaError);

    // La fila real de la empresa A no cambió nada — ni el intento
    // falló a medias, ni "robó" la fila ajena.
    const [filaA] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaA.nickname).toBe("VENDEDOR_A");
    expect(descifrarToken(filaA.accessTokenCifrado)).toBe("access-a");

    // Y nunca quedó una fila nueva (ni siquiera a medio insertar) del
    // lado de empresa B.
    const todas = await dbComoEmpresa(empresaAId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna)));
    expect(todas).toHaveLength(1);
    expect(todas[0].id).toBe(deEmpresaA.id);
  });
});

// Issue #181 — en vez de solo avisar, se ofrece transferir la cuenta
// de la empresa dueña actual a la que la está conectando. El camino
// privilegiado (dbComoTransferenciaCuentaMl, db/empresa-context.ts) es
// justo lo que estas pruebas confirman que SOLO alcanza para la fila
// puntual del cuenta_id_externa correcto — nunca con el superusuario,
// nunca filtrando a otras filas.
describe("transferir una cuenta de Mercado Libre a otra empresa (issue #181) — RLS real", () => {
  it("obtenerEmpresaDueñaDeCuentaMl: lee el nombre de la empresa dueña actual, de solo lectura (nunca modifica la fila)", async () => {
    const { empresaAId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });

    const dueña = await obtenerEmpresaDueñaDeCuentaMl(cuentaIdExterna);
    expect(dueña?.empresaId).toBe(empresaAId);
    expect(dueña?.empresaNombre).toBe("Empresa A (prueba de aislamiento)");

    // "Cancelar" (issue #181) es justamente NO llamar a
    // transferirCuentaMlAOtraEmpresa — confirmar que la sola lectura de
    // arriba (lo que corre la pantalla de confirmación antes de que
    // nadie decida nada) nunca movió la fila.
    const [filaSinTocar] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaSinTocar.empresaId).toBe(empresaAId);
    expect(filaSinTocar.nickname).toBe("VENDEDOR_A");
  });

  it("obtenerEmpresaDueñaDeCuentaMl: cuenta_id_externa desconocido -> null", async () => {
    const dueña = await obtenerEmpresaDueñaDeCuentaMl(`inexistente-${Date.now()}`);
    expect(dueña).toBeNull();
  });

  it("transferirCuentaMlAOtraEmpresa: mueve la ÚNICA fila de empresa A a empresa B con tokens/nickname nuevos, sin tocar su histórico", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });

    const transferida = await transferirCuentaMlAOtraEmpresa(empresaBId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_TRANSFERIDO",
      tokens: tokensDePrueba(cuentaIdExterna, "transferida"),
      siteId: null,
    });

    // Mismo id — es la MISMA fila, nunca una nueva.
    expect(transferida.id).toBe(deEmpresaA.id);

    // Empresa A, con su contexto normal (dbComoEmpresa), ya no ve la
    // cuenta — RLS a FORCE de siempre, nada especial para ella.
    const veA = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(veA).toHaveLength(0);

    // Empresa B ya la ve, con los datos nuevos y reactivada.
    const [filaB] = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaB.empresaId).toBe(empresaBId);
    expect(filaB.nickname).toBe("VENDEDOR_TRANSFERIDO");
    expect(descifrarToken(filaB.accessTokenCifrado)).toBe("access-transferida");
    expect(filaB.desconectadaTs).toBeNull();
    expect(filaB.renovandoTs).toBeNull();

    // Nunca una segunda fila para el mismo cuenta_id_externa.
    const todas = await dbComoEmpresa(empresaBId, (tx) => tx.select({ id: cuentasMl.id }).from(cuentasMl).where(eq(cuentasMl.cuentaIdExterna, cuentaIdExterna)));
    expect(todas).toHaveLength(1);
  });

  it("transferirCuentaMlAOtraEmpresa: funciona igual si la cuenta estaba desconectada en la empresa anterior", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });
    await desconectarCuenta(empresaAId, deEmpresaA.id);

    const transferida = await transferirCuentaMlAOtraEmpresa(empresaBId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_TRANSFERIDO",
      tokens: tokensDePrueba(cuentaIdExterna, "transferida"),
      siteId: null,
    });

    const [filaB] = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, transferida.id)));
    expect(filaB.desconectadaTs).toBeNull();
  });

  it("empresa B, con su contexto normal (dbComoEmpresa), nunca puede transferirse la cuenta a sí misma sin el camino privilegiado", async () => {
    const { empresaAId, empresaBId } = await crearDosEmpresas();
    const cuentaIdExterna = `${Date.now()}${Math.floor(Math.random() * 10_000)}`;

    const deEmpresaA = await guardarCuentaConectada(empresaAId, {
      cuentaIdExterna,
      nickname: "VENDEDOR_A",
      tokens: tokensDePrueba(cuentaIdExterna, "a"),
      siteId: null,
    });

    // Mismo UPDATE que transferirCuentaMlAOtraEmpresa hace de verdad,
    // pero con el contexto de empresa de siempre — RLS a FORCE tiene
    // que bloquearlo igual que bloquea cualquier otro intento de tocar
    // la fila de otra empresa.
    const actualizadas = await dbComoEmpresa(empresaBId, (tx) =>
      tx.update(cuentasMl).set({ empresaId: empresaBId }).where(eq(cuentasMl.id, deEmpresaA.id)).returning({ id: cuentasMl.id })
    );
    expect(actualizadas).toHaveLength(0);

    const [filaIntacta] = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, deEmpresaA.id)));
    expect(filaIntacta.empresaId).toBe(empresaAId);
  });
});
