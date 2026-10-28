import { randomUUID } from "crypto";
import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "./empresa-context";
import { auditoria, cuentasMl, titulares } from "./schema";
import { afirmarAislamiento, crearDosEmpresas, type ContextoDosEmpresas } from "./test-utils/aislamiento";
import { CuentaMlNoEncontradaError, TitularNoEncontradoError, crearTitular, asignarTitularACuenta } from "../lib/titulares";
import { transferirCuentaMlAOtraEmpresa } from "../lib/ml/cuentas";

// Issue #125 — titulares. La FK compuesta (empresa_id, titular_id) es
// la que impide colgarle a una cuenta de A un titular de B: el id del
// titular es único en toda la tabla, así que una FK solo por titular_id
// no alcanzaría.

const tokenFalso = { version: 1, iv: "aGk", authTag: "dGFn", datos: "eA" };

describe("titulares (RLS, issue #125)", () => {
  let contexto: ContextoDosEmpresas;
  let titularAId: string;
  let cuentaAId: string;

  beforeAll(async () => {
    contexto = await crearDosEmpresas();
    const fila = await afirmarAislamiento(contexto, titulares, (tx, empresaId) =>
      tx
        .insert(titulares)
        .values({
          empresaId,
          tipo: "persona",
          nombre: "Titular de A",
          documento: `900111${empresaId.slice(0, 6)}`,
        })
        .returning({ id: titulares.id })
    );
    titularAId = fila.id;

    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: contexto.empresaAId,
          cuentaIdExterna: `ml-titular-${randomUUID()}`,
          nickname: "CUENTA_A",
          accessTokenCifrado: tokenFalso,
          refreshTokenCifrado: tokenFalso,
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaAId = cuenta.id;
  });

  it("el mismo documento en empresas distintas sí se puede; en la misma, no", async () => {
    const documento = "9005551234";
    await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.insert(titulares).values({ empresaId: contexto.empresaAId, tipo: "sociedad", nombre: "Sociedad A", documento })
    );
    await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx.insert(titulares).values({ empresaId: contexto.empresaBId, tipo: "sociedad", nombre: "Sociedad B", documento })
    );
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.insert(titulares).values({ empresaId: contexto.empresaAId, tipo: "persona", nombre: "Repetido en A", documento })
      )
    ).rejects.toThrow();
  });

  it("un tipo que no sea persona o sociedad falla", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.execute(
          sql`insert into titulares (empresa_id, tipo, nombre, documento) values (${contexto.empresaAId}, 'otro', 'Nadie', '8123456789')`
        )
      )
    ).rejects.toThrow();
  });

  it("asignar a una cuenta de A un titular de B falla, y la cuenta sigue sin ese titular", async () => {
    const [titularB] = await dbComoEmpresa(contexto.empresaBId, (tx) =>
      tx
        .insert(titulares)
        .values({ empresaId: contexto.empresaBId, tipo: "persona", nombre: "Titular de B", documento: "8002223344" })
        .returning({ id: titulares.id })
    );

    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.update(cuentasMl).set({ titularId: titularB.id }).where(eq(cuentasMl.id, cuentaAId))
      )
    ).rejects.toThrow();

    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select({ titularId: cuentasMl.titularId }).from(cuentasMl).where(eq(cuentasMl.id, cuentaAId))
    );
    expect(cuenta.titularId).toBeNull();

    await expect(
      asignarTitularACuenta({
        empresaId: contexto.empresaAId,
        usuarioId: contexto.usuarioAId,
        cuentaMlId: cuentaAId,
        titularId: titularB.id,
      })
    ).rejects.toBeInstanceOf(TitularNoEncontradoError);
  });

  it("la cuenta de A sí acepta un titular de A, y borrar ese titular después falla", async () => {
    await asignarTitularACuenta({
      empresaId: contexto.empresaAId,
      usuarioId: contexto.usuarioAId,
      cuentaMlId: cuentaAId,
      titularId: titularAId,
    });
    const [cuenta] = await dbComoEmpresa(contexto.empresaAId, (tx) =>
      tx.select({ titularId: cuentasMl.titularId }).from(cuentasMl).where(eq(cuentasMl.id, cuentaAId))
    );
    expect(cuenta.titularId).toBe(titularAId);

    await expect(
      dbComoEmpresa(contexto.empresaAId, (tx) => tx.delete(titulares).where(eq(titulares.id, titularAId)))
    ).rejects.toThrow();
  });

  it("empresa B no puede apuntar una cuenta nueva al titular de A ni aunque invente el par", async () => {
    await expect(
      dbComoEmpresa(contexto.empresaBId, (tx) =>
        tx.insert(cuentasMl).values({
          empresaId: contexto.empresaBId,
          titularId: titularAId,
          cuentaIdExterna: `ml-cruce-${randomUUID()}`,
          nickname: "CUENTA_B",
          accessTokenCifrado: tokenFalso,
          refreshTokenCifrado: tokenFalso,
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
      )
    ).rejects.toThrow();
  });

  it("el documento no queda en la bitácora ni en los logs, solo los últimos dígitos", async () => {
    const documento = "9012345678";
    const llamadas: string[] = [];
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((metodo) =>
      vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
        llamadas.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      })
    );
    try {
      const { id } = await crearTitular({
        empresaId: contexto.empresaAId,
        usuarioId: contexto.usuarioAId,
        tipo: "persona",
        nombre: "Ana Titular",
        documento,
      });
      const filas = await dbComoEmpresa(contexto.empresaAId, (tx) =>
        tx.select().from(auditoria).where(eq(auditoria.entidadId, id))
      );
      expect(filas).toHaveLength(1);
      const texto = JSON.stringify(filas[0]);
      expect(texto).not.toContain(documento);
      expect(filas[0].valorNuevo).toBe("***5678");
      expect(filas[0].detalle).toContain("Ana Titular");
      expect(llamadas.join("\n")).not.toContain(documento);
    } finally {
      spies.forEach((s) => s.mockRestore());
    }
  });

  it("asignar el titular a una cuenta que no es de esta empresa no toca nada", async () => {
    await expect(
      asignarTitularACuenta({
        empresaId: contexto.empresaBId,
        usuarioId: contexto.usuarioBId,
        cuentaMlId: cuentaAId,
        titularId: titularAId,
      })
    ).rejects.toBeInstanceOf(CuentaMlNoEncontradaError);
  });
});

// Issue #181 + #125 — transferir una cuenta con titular a otra empresa.
// El titular es de la empresa anterior: con la FK compuesta, cambiar
// empresa_id y dejar el titular_id viejo falla.
describe("transferir una cuenta con titular (issue #125)", () => {
  it("la cuenta llega a la otra empresa sin titular, y el titular se queda en la anterior", async () => {
    const { empresaAId, empresaBId, usuarioAId } = await crearDosEmpresas();
    const cuentaIdExterna = `ml-transferir-titular-${randomUUID()}`;
    const [cuenta] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna,
          nickname: "CUENTA_CON_TITULAR",
          accessTokenCifrado: tokenFalso,
          refreshTokenCifrado: tokenFalso,
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const { id: titularId } = await crearTitular({
      empresaId: empresaAId,
      usuarioId: usuarioAId,
      tipo: "persona",
      nombre: "Titular que se queda en A",
      documento: `700${randomUUID().slice(0, 7)}`,
    });
    await asignarTitularACuenta({ empresaId: empresaAId, usuarioId: usuarioAId, cuentaMlId: cuenta.id, titularId });

    await transferirCuentaMlAOtraEmpresa(empresaBId, {
      cuentaIdExterna,
      nickname: "CUENTA_EN_B",
      tokens: { accessToken: "access-b", refreshToken: "refresh-b", expiraEnSegundos: 21_600, cuentaIdExterna },
    });

    const [enB] = await dbComoEmpresa(empresaBId, (tx) =>
      tx.select({ empresaId: cuentasMl.empresaId, titularId: cuentasMl.titularId }).from(cuentasMl).where(eq(cuentasMl.id, cuenta.id))
    );
    expect(enB.empresaId).toBe(empresaBId);
    expect(enB.titularId).toBeNull();

    const titularEnA = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(titulares).where(eq(titulares.id, titularId)));
    expect(titularEnA).toHaveLength(1);
  });
});
