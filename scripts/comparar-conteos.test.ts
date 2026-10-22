import { describe, expect, it } from "vitest";
import {
  citarTabla,
  compararConteos,
  consultaConteos,
  conteoDesdeTexto,
  decisionSaltoRls,
  esLaMismaBase,
  formatearComparacion,
  hayDiferencias,
  mensajeErrorSeguro,
  mensajeVariablesFaltantes,
  urlsSonIguales,
  variablesFaltantes,
} from "./comparar-conteos-logica";

describe("compararConteos", () => {
  it("no marca diferencia cuando cada tabla tiene el mismo conteo", () => {
    const filas = compararConteos(
      [
        { tabla: "pedidos", filas: 10 },
        { tabla: "empresas", filas: 2 },
      ],
      [
        { tabla: "empresas", filas: 2 },
        { tabla: "pedidos", filas: 10 },
      ],
    );
    expect(filas).toEqual([
      { tabla: "empresas", origen: 2, restaurada: 2 },
      { tabla: "pedidos", origen: 10, restaurada: 10 },
    ]);
    expect(hayDiferencias(filas)).toBe(false);
    expect(formatearComparacion(filas)).toBe("empresas 2 2\npedidos 10 10");
  });

  it("marca diferencia cuando el conteo no coincide", () => {
    const filas = compararConteos(
      [{ tabla: "pedidos", filas: 10 }],
      [{ tabla: "pedidos", filas: 9 }],
    );
    expect(hayDiferencias(filas)).toBe(true);
    expect(formatearComparacion(filas)).toBe("pedidos 10 9");
  });

  it("una tabla que falta en un lado no es un conteo cero", () => {
    const filas = compararConteos(
      [
        { tabla: "avisos_ml", filas: 4 },
        { tabla: "empresas", filas: 1 },
      ],
      [{ tabla: "empresas", filas: 0 }],
    );
    expect(filas).toEqual([
      { tabla: "avisos_ml", origen: 4, restaurada: null },
      { tabla: "empresas", origen: 1, restaurada: 0 },
    ]);
    expect(hayDiferencias(filas)).toBe(true);
    expect(formatearComparacion(filas)).toBe("avisos_ml 4 -\nempresas 1 0");
  });

  it("una tabla que existe solo en la restaurada también difiere", () => {
    const filas = compararConteos([], [{ tabla: "skus", filas: 3 }]);
    expect(filas).toEqual([{ tabla: "skus", origen: null, restaurada: 3 }]);
    expect(hayDiferencias(filas)).toBe(true);
  });

  it("dos lados sin tablas no son una diferencia", () => {
    const filas = compararConteos([], []);
    expect(filas).toEqual([]);
    expect(hayDiferencias(filas)).toBe(false);
    expect(formatearComparacion(filas)).toBe("");
  });

  it("rechaza una tabla repetida en el mismo lado", () => {
    expect(() =>
      compararConteos(
        [
          { tabla: "empresas", filas: 1 },
          { tabla: "empresas", filas: 2 },
        ],
        [],
      ),
    ).toThrow(/Tabla repetida/);
  });

  it("rechaza un conteo negativo o fraccionario", () => {
    expect(() => compararConteos([{ tabla: "empresas", filas: -1 }], [])).toThrow(/Conteo inválido/);
    expect(() => compararConteos([{ tabla: "empresas", filas: 1.5 }], [])).toThrow(/Conteo inválido/);
  });
});

describe("variables y la misma base", () => {
  it("pide las dos variables cuando faltan, están vacías o son solo espacios", () => {
    expect(variablesFaltantes({})).toEqual(["DATABASE_URL_ORIGEN", "DATABASE_URL_RESTAURADA"]);
    expect(variablesFaltantes({ DATABASE_URL_ORIGEN: "  ", DATABASE_URL_RESTAURADA: "postgresql://ejemplo" })).toEqual([
      "DATABASE_URL_ORIGEN",
    ]);
    expect(
      variablesFaltantes({
        DATABASE_URL_ORIGEN: "postgresql://origen",
        DATABASE_URL_RESTAURADA: "postgresql://restaurada",
      }),
    ).toEqual([]);
  });

  it("el mensaje de variables nombra la que falta y no incluye una URL", () => {
    const mensaje = mensajeVariablesFaltantes(["DATABASE_URL_RESTAURADA"]);
    expect(mensaje).toContain("DATABASE_URL_RESTAURADA");
    expect(mensaje).not.toContain("postgresql://");
    expect(mensaje).toContain("No pegues la cadena de conexión");
  });

  it("la misma cadena, aunque tenga espacios en los bordes, no es una base temporal", () => {
    expect(urlsSonIguales(" postgresql://misma ", "postgresql://misma")).toBe(true);
    expect(urlsSonIguales("postgresql://origen", "postgresql://temporal")).toBe(false);
  });

  it("misma dirección y mismo nombre de base es el mismo Postgres; otro nombre en el mismo servidor no lo es", () => {
    const origen = { base: "railway", dir: "10.0.0.8", puerto: "5432" };
    expect(esLaMismaBase(origen, { ...origen })).toBe(true);
    expect(esLaMismaBase(origen, { ...origen, base: "restore_drill" })).toBe(false);
    expect(esLaMismaBase(origen, { ...origen, dir: "10.0.0.9" })).toBe(false);
    expect(esLaMismaBase({ ...origen, dir: "" }, { ...origen, dir: "" })).toBe(false);
  });
});

describe("decisionSaltoRls", () => {
  it("acepta la conexión solo cuando rolsuper OR rolbypassrls es true", () => {
    expect(decisionSaltoRls("origen", true)).toEqual({ ok: true });
    expect(decisionSaltoRls("restaurada", true)).toEqual({ ok: true });
  });

  it("rechaza origen y restaurada con el mismo texto, sin URL ni nombre de rol", () => {
    for (const lado of ["origen", "restaurada"] as const) {
      const decision = decisionSaltoRls(lado, false);
      expect(decision.ok).toBe(false);
      if (!decision.ok) {
        expect(decision.mensaje).toBe(
          `La conexión de ${lado} no salta RLS; los conteos saldrían filtrados por empresa. Usa el usuario postgres del túnel.`,
        );
        expect(decision.mensaje).not.toContain("postgresql://");
        expect(decision.mensaje).not.toContain("app_user");
        expect(decision.mensaje).not.toContain("@");
      }
    }
  });

  it("si Postgres no devolvió la fila del rol, también rechaza", () => {
    const decision = decisionSaltoRls("origen", null);
    expect(decision.ok).toBe(false);
    if (!decision.ok) {
      expect(decision.mensaje).toContain("La conexión de origen no salta RLS");
    }
  });
});

describe("consulta de conteos", () => {
  it("arma un SELECT de count por tabla, con el identificador citado", () => {
    expect(consultaConteos(["empresas", "pedidos"])).toBe(
      `SELECT 'empresas'::text AS tabla, count(*)::text AS filas FROM public."empresas" UNION ALL SELECT 'pedidos'::text AS tabla, count(*)::text AS filas FROM public."pedidos"`,
    );
    expect(consultaConteos([])).toContain("WHERE false");
    expect(consultaConteos(["empresas"])).not.toContain(";");
  });

  it("no cita un nombre que pueda cambiar la sentencia", () => {
    expect(() => citarTabla('empresas"; drop table empresas; --')).toThrow(/No se imprime el nombre/);
    expect(() => citarTabla("public.empresas")).toThrow(/No se imprime el nombre/);
    expect(citarTabla("avisos_ml")).toBe('"avisos_ml"');
  });

  it("acepta un conteo entero en texto y rechaza cualquier otra cosa", () => {
    expect(conteoDesdeTexto("empresas", "0")).toEqual({ tabla: "empresas", filas: 0 });
    expect(conteoDesdeTexto("empresas", "42")).toEqual({ tabla: "empresas", filas: 42 });
    expect(() => conteoDesdeTexto("empresas", "42 filas")).toThrow(/No se imprime el valor/);
    expect(() => conteoDesdeTexto("no es tabla", "1")).toThrow(/No se imprime el valor/);
  });
});

describe("mensajeErrorSeguro", () => {
  it("saca la cadena de conexión, la contraseña y el host del mensaje", () => {
    const error = new Error(
      'connect ECONNREFUSED 10.1.2.3:5432 password=secreto postgresql://postgres:secreto@10.1.2.3:5432/railway',
    );
    const mensaje = mensajeErrorSeguro(error);
    expect(mensaje).not.toContain("postgresql://");
    expect(mensaje).not.toContain("secreto");
    expect(mensaje).not.toContain("10.1.2.3");
    expect(mensaje).toContain("Falló la lectura");
  });
});
