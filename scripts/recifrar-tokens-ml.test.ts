import { randomBytes, randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dbComoEmpresa } from "../db/empresa-context";
import { cuentasMl, empresas } from "../db/schema";
import { cifrarToken, descifrarToken, type TokenCifrado } from "../lib/cifrado";
import {
  abrirConexion,
  esEntradaDirecta,
  ejecutarRecifrado,
  leerOpciones,
  mensajeErrorSeguro,
  prepararRecifrado,
  RecifradoError,
  recifrarCuentasMl,
  textoConteo,
  type RepositorioRecifrado,
} from "./recifrar-tokens-ml";

function claveDePrueba(): string {
  return randomBytes(32).toString("base64");
}

function campos(token: TokenCifrado) {
  return { version: token.version, iv: token.iv, authTag: token.authTag, datos: token.datos };
}

describe("re-cifrado de tokens (Z-SEC-01)", () => {
  beforeEach(() => {
    process.env.ML_TOKEN_KEY_V1 = claveDePrueba();
    delete process.env.ML_TOKEN_KEY_V2;
    delete process.env.ML_TOKEN_KEY_ACTUAL;
  });

  it("importar el módulo no lo ejecuta", () => {
    expect(esEntradaDirecta()).toBe(false);
  });

  it("solo acepta --dry-run", () => {
    expect(leerOpciones([])).toEqual({ dryRun: false });
    expect(leerOpciones(["--dry-run"])).toEqual({ dryRun: true });
    expect(leerOpciones(["--dry-run", "--dry-run"])).toEqual({ dryRun: true });
    expect(() => leerOpciones(["--help"])).toThrow(RecifradoError);
  });

  it("el texto que se imprime son solo conteos", () => {
    const plano = "plano-que-no-puede-salir";
    const clave = claveDePrueba();
    const linea = textoConteo({
      revisadas: 4,
      conVersionAnterior: 2,
      actualizadas: 0,
      yaActuales: 2,
      dryRun: true,
    });
    expect(linea).toBe(
      "Revisadas: 4. Encontradas atrás: 2. Actualizadas: 0. Ya en la versión actual: 2. Simulación: sí."
    );
    expect(linea).not.toContain(plano);
    expect(linea).not.toContain(clave);
  });

  it("un error ajeno no se imprime: puede traer el token cifrado en la consulta", () => {
    const plano = "plano-que-no-puede-salir";
    const clave = claveDePrueba();
    const cifrado = cifrarToken(plano);
    const error = new Error(`falló ${plano} ${clave} ${cifrado.datos} ${cifrado.iv} ${cifrado.authTag}`);
    const mensaje = mensajeErrorSeguro(error);
    expect(mensaje).toBe("No se pudo recifrar. No se imprimen tokens, claves ni el error interno.");
    expect(mensaje).not.toContain(plano);
    expect(mensaje).not.toContain(clave);
    expect(mensaje).not.toContain(cifrado.datos);
    expect(mensaje).not.toContain(cifrado.iv);
    expect(mensaje).not.toContain(cifrado.authTag);
  });

  it("una versión inválida falla sin incluir el contenido de la fila", () => {
    const secreto = claveDePrueba();
    expect(() =>
      prepararRecifrado(
        {
          access: { version: 0, iv: "a", authTag: "b", datos: secreto },
          refresh: { version: 1, iv: "a", authTag: "b", datos: "c" },
        },
        2
      )
    ).toThrow(RecifradoError);
    try {
      prepararRecifrado(
        {
          access: { version: 0, iv: "a", authTag: "b", datos: secreto },
          refresh: { version: 1, iv: "a", authTag: "b", datos: "c" },
        },
        2
      );
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      expect(mensaje).not.toContain(secreto);
      expect(mensaje).not.toContain("datos");
    }
  });

  it("la simulación cuenta y no descifra ni escribe", async () => {
    let escritos = 0;
    const repo: RepositorioRecifrado = {
      async listarVersiones() {
        return [
          { id: "atrasada", versionAccess: 1, versionRefresh: 1 },
          { id: "al-dia", versionAccess: 2, versionRefresh: 2 },
        ];
      },
      async recifrarSiAtrasada() {
        escritos += 1;
        return "actualizada";
      },
    };
    process.env.ML_TOKEN_KEY_ACTUAL = "2";
    const conteo = await recifrarCuentasMl(repo, { dryRun: true });
    expect(escritos).toBe(0);
    expect(conteo).toEqual({
      revisadas: 2,
      conVersionAnterior: 1,
      actualizadas: 0,
      yaActuales: 1,
      dryRun: true,
    });
  });

  it("no baja de versión un token ya cifrado con una clave más nueva", () => {
    process.env.ML_TOKEN_KEY_V2 = claveDePrueba();
    process.env.ML_TOKEN_KEY_ACTUAL = "2";
    const access = cifrarToken("access-nuevo");
    const refresh = cifrarToken("refresh-nuevo");
    const preparado = prepararRecifrado({ access, refresh }, 1);
    expect(preparado.cambia).toBe(false);
    expect(preparado.access).toBe(access);
    expect(preparado.refresh).toBe(refresh);
  });

  it("con la clave vieja ausente, el error es claro y la fila no cambia", () => {
    const planoAccess = "plano-access-prueba";
    const planoRefresh = "plano-refresh-prueba";
    const access = cifrarToken(planoAccess);
    const refresh = cifrarToken(planoRefresh);
    const claveV1 = process.env.ML_TOKEN_KEY_V1 ?? "";
    delete process.env.ML_TOKEN_KEY_V1;
    process.env.ML_TOKEN_KEY_V2 = claveDePrueba();
    process.env.ML_TOKEN_KEY_ACTUAL = "2";
    expect(() => prepararRecifrado({ access, refresh }, 2)).toThrow(RecifradoError);
    try {
      prepararRecifrado({ access, refresh }, 2);
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      expect(mensaje).toBe("No se puede recifrar: falta ML_TOKEN_KEY_V1. La fila no se modificó.");
      expect(mensaje).not.toContain(planoAccess);
      expect(mensaje).not.toContain(planoRefresh);
      expect(mensaje).not.toContain(claveV1);
      expect(mensaje).not.toContain(access.datos);
      expect(mensaje).not.toContain(access.iv);
      expect(mensaje).not.toContain(access.authTag);
      expect(mensaje).not.toContain(refresh.datos);
    }
    expect(access.version).toBe(1);
    expect(refresh.version).toBe(1);
  });
});

describe("re-cifrado contra Postgres", () => {
  const empresaAId = randomUUID();
  const empresaBId = randomUUID();
  const empresaControlId = randomUUID();
  const planoA = "plano-access-empresa-a";
  const planoRefreshA = "plano-refresh-empresa-a";
  const planoB = "plano-access-empresa-b";
  const planoRefreshB = "plano-refresh-empresa-b";
  const planoParcial = "plano-access-parcial";
  const planoRefreshParcial = "plano-refresh-ya-v2";
  const claveV1 = claveDePrueba();
  const claveV2 = claveDePrueba();
  const renovando = new Date("2020-01-01T00:00:00.000Z");
  const envPrevio = {
    v1: process.env.ML_TOKEN_KEY_V1,
    v2: process.env.ML_TOKEN_KEY_V2,
    actual: process.env.ML_TOKEN_KEY_ACTUAL,
  };

  let cuentaAId: string;
  let cuentaBId: string;
  let cuentaParcialId: string;
  let cuentaControlId: string;
  let refreshParcialAntes: TokenCifrado;
  let conexion: ReturnType<typeof abrirConexion>;

  function restaurar(nombre: "ML_TOKEN_KEY_V1" | "ML_TOKEN_KEY_V2" | "ML_TOKEN_KEY_ACTUAL", valor: string | undefined) {
    if (valor === undefined) delete process.env[nombre];
    else process.env[nombre] = valor;
  }

  beforeAll(async () => {
    process.env.ML_TOKEN_KEY_V1 = claveV1;
    process.env.ML_TOKEN_KEY_V2 = claveV2;
    process.env.ML_TOKEN_KEY_ACTUAL = "1";

    conexion = abrirConexion(process.env.DATABASE_URL, "Falta DATABASE_URL.");

    for (const [id, nombre, nit] of [
      [empresaAId, "Empresa A recifrado", `TEST-RA-${empresaAId.slice(0, 8)}`],
      [empresaBId, "Empresa B recifrado", `TEST-RB-${empresaBId.slice(0, 8)}`],
      [empresaControlId, "Empresa control recifrado", `TEST-RC-${empresaControlId.slice(0, 8)}`],
    ] as const) {
      await dbComoEmpresa(id, (tx) => tx.insert(empresas).values({ id, nombre, nit }));
    }

    const insertar = async (empresaId: string, access: string, refresh: string, extra?: { renovandoTs?: Date }) => {
      const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
        tx
          .insert(cuentasMl)
          .values({
            empresaId,
            cuentaIdExterna: `ml-${randomUUID()}`,
            nickname: "VENDEDOR_PRUEBA",
            accessTokenCifrado: cifrarToken(access),
            refreshTokenCifrado: cifrarToken(refresh),
            tokenExpiraTs: new Date(Date.now() + 3600_000),
            renovandoTs: extra?.renovandoTs,
          })
          .returning({ id: cuentasMl.id })
      );
      return cuenta.id;
    };

    cuentaAId = await insertar(empresaAId, planoA, planoRefreshA, { renovandoTs: renovando });
    cuentaBId = await insertar(empresaBId, planoB, planoRefreshB);
    cuentaControlId = await insertar(empresaControlId, "plano-control", "refresh-control");

    process.env.ML_TOKEN_KEY_ACTUAL = "2";
    refreshParcialAntes = cifrarToken(planoRefreshParcial);
    process.env.ML_TOKEN_KEY_ACTUAL = "1";
    const accessParcial = cifrarToken(planoParcial);
    const [parcial] = await dbComoEmpresa(empresaAId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaAId,
          cuentaIdExterna: `ml-${randomUUID()}`,
          nickname: "VENDEDOR_PARCIAL",
          accessTokenCifrado: accessParcial,
          refreshTokenCifrado: refreshParcialAntes,
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    cuentaParcialId = parcial.id;
    process.env.ML_TOKEN_KEY_ACTUAL = "2";
  });

  afterAll(async () => {
    restaurar("ML_TOKEN_KEY_V1", envPrevio.v1);
    restaurar("ML_TOKEN_KEY_V2", envPrevio.v2);
    restaurar("ML_TOKEN_KEY_ACTUAL", envPrevio.actual);
    await conexion?.cerrar();
  });

  async function leer(id: string) {
    const [fila] = await conexion.db
      .select({
        access: cuentasMl.accessTokenCifrado,
        refresh: cuentasMl.refreshTokenCifrado,
        renovandoTs: cuentasMl.renovandoTs,
      })
      .from(cuentasMl)
      .where(eq(cuentasMl.id, id));
    return fila;
  }

  const ids = () => [cuentaAId, cuentaBId, cuentaParcialId];

  it("la simulación no modifica filas", async () => {
    const antes = await Promise.all(ids().map((id) => leer(id)));
    const conteo = await ejecutarRecifrado({ dryRun: true, ids: ids(), conexion });
    expect(conteo).toEqual({
      revisadas: 3,
      conVersionAnterior: 3,
      actualizadas: 0,
      yaActuales: 0,
      dryRun: true,
    });
    const despues = await Promise.all(ids().map((id) => leer(id)));
    expect(despues.map((fila) => campos(fila.access))).toEqual(antes.map((fila) => campos(fila.access)));
    expect(despues.map((fila) => campos(fila.refresh))).toEqual(antes.map((fila) => campos(fila.refresh)));
  });

  it("deja las filas pedidas en V2, no toca la que quedó afuera, y una segunda corrida no cambia nada", async () => {
    const lineas: string[] = [];
    const log = console.log;
    const error = console.error;
    console.log = (mensaje?: unknown) => {
      lineas.push(String(mensaje));
    };
    console.error = (mensaje?: unknown) => {
      lineas.push(String(mensaje));
    };
    let despuesDeLaPrimera: Awaited<ReturnType<typeof leer>>[];
    try {
      const conteo = await ejecutarRecifrado({ dryRun: false, ids: ids(), conexion });
      expect(conteo.actualizadas).toBe(3);
      expect(conteo.conVersionAnterior).toBe(3);
      expect(conteo.dryRun).toBe(false);

      const cuentaA = await leer(cuentaAId);
      expect(cuentaA.access.version).toBe(2);
      expect(cuentaA.refresh.version).toBe(2);
      expect(descifrarToken(cuentaA.access)).toBe(planoA);
      expect(descifrarToken(cuentaA.refresh)).toBe(planoRefreshA);
      expect(cuentaA.renovandoTs?.getTime()).toBe(renovando.getTime());

      const cuentaB = await leer(cuentaBId);
      expect(descifrarToken(cuentaB.access)).toBe(planoB);
      expect(descifrarToken(cuentaB.refresh)).toBe(planoRefreshB);
      expect(cuentaB.access.version).toBe(2);

      const parcial = await leer(cuentaParcialId);
      expect(parcial.access.version).toBe(2);
      expect(descifrarToken(parcial.access)).toBe(planoParcial);
      expect(campos(parcial.refresh)).toEqual(campos(refreshParcialAntes));
      expect(descifrarToken(parcial.refresh)).toBe(planoRefreshParcial);

      const control = await leer(cuentaControlId);
      expect(control.access.version).toBe(1);
      expect(control.refresh.version).toBe(1);

      despuesDeLaPrimera = await Promise.all(ids().map((id) => leer(id)));
      const segunda = await ejecutarRecifrado({ dryRun: false, ids: ids(), conexion });
      expect(segunda).toEqual({
        revisadas: 3,
        conVersionAnterior: 0,
        actualizadas: 0,
        yaActuales: 3,
        dryRun: false,
      });
      const despuesDeLaSegunda = await Promise.all(ids().map((id) => leer(id)));
      expect(despuesDeLaSegunda.map((fila) => campos(fila.access))).toEqual(despuesDeLaPrimera.map((fila) => campos(fila.access)));
      expect(despuesDeLaSegunda.map((fila) => campos(fila.refresh))).toEqual(despuesDeLaPrimera.map((fila) => campos(fila.refresh)));
    } finally {
      console.log = log;
      console.error = error;
    }
    const volcado = lineas.join("\n");
    for (const secreto of [planoA, planoRefreshA, planoB, planoRefreshB, planoParcial, planoRefreshParcial, claveV1, claveV2]) {
      expect(volcado).not.toContain(secreto);
    }
  });

  it("cada empresa sigue viendo solo su cuenta", async () => {
    const deA = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaBId)));
    const deB = await dbComoEmpresa(empresaBId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    const propia = await dbComoEmpresa(empresaAId, (tx) => tx.select().from(cuentasMl).where(eq(cuentasMl.id, cuentaAId)));
    expect(deA).toHaveLength(0);
    expect(deB).toHaveLength(0);
    expect(propia).toHaveLength(1);
    expect(propia[0].accessTokenCifrado.version).toBe(2);
  });

  it("con V1 ausente y una fila en V1, no escribe y el error no trae valores", async () => {
    process.env.ML_TOKEN_KEY_ACTUAL = "1";
    const plano = "plano-fila-sin-clave-vieja";
    const [cuenta] = await dbComoEmpresa(empresaBId, (tx) =>
      tx
        .insert(cuentasMl)
        .values({
          empresaId: empresaBId,
          cuentaIdExterna: `ml-${randomUUID()}`,
          nickname: "VENDEDOR_SIN_CLAVE",
          accessTokenCifrado: cifrarToken(plano),
          refreshTokenCifrado: cifrarToken("refresh-sin-clave"),
          tokenExpiraTs: new Date(Date.now() + 3600_000),
        })
        .returning({ id: cuentasMl.id })
    );
    const antes = await leer(cuenta.id);
    process.env.ML_TOKEN_KEY_ACTUAL = "2";
    delete process.env.ML_TOKEN_KEY_V1;
    try {
      await expect(ejecutarRecifrado({ dryRun: false, ids: [cuenta.id], conexion })).rejects.toBeInstanceOf(RecifradoError);
      try {
        await ejecutarRecifrado({ dryRun: false, ids: [cuenta.id], conexion });
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        expect(mensaje).toBe("No se puede recifrar: falta ML_TOKEN_KEY_V1. La fila no se modificó.");
        expect(mensaje).not.toContain(plano);
        expect(mensaje).not.toContain(claveV1);
        expect(mensaje).not.toContain(claveV2);
        expect(mensaje).not.toContain(antes.access.datos);
        expect(mensaje).not.toContain(antes.access.iv);
        expect(mensaje).not.toContain(antes.refresh.datos);
      }
      const despues = await leer(cuenta.id);
      expect(campos(despues.access)).toEqual(campos(antes.access));
      expect(campos(despues.refresh)).toEqual(campos(antes.refresh));
    } finally {
      process.env.ML_TOKEN_KEY_V1 = claveV1;
      process.env.ML_TOKEN_KEY_ACTUAL = "2";
    }
  });

  it("app_user no puede correr el re-cifrado: se detiene y no escribe", async () => {
    const app = abrirConexion(process.env.DATABASE_URL_APP, "Falta DATABASE_URL_APP.");
    const antes = await leer(cuentaControlId);
    try {
      await expect(
        ejecutarRecifrado({ dryRun: false, ids: [cuentaControlId], conexion: app })
      ).rejects.toThrow(/app_user/);
      try {
        await ejecutarRecifrado({ dryRun: false, ids: [cuentaControlId], conexion: app });
      } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        expect(mensaje).not.toContain("postgresql://");
        expect(mensaje).not.toContain(claveV1);
        expect(mensaje).not.toContain(antes.access.datos);
      }
      const despues = await leer(cuentaControlId);
      expect(campos(despues.access)).toEqual(campos(antes.access));
      expect(despues.access.version).toBe(1);
    } finally {
      await app.cerrar();
    }
  });
});
