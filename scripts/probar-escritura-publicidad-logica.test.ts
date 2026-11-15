import { describe, expect, it } from "vitest";
import { cambiosInesperados, camposDeCampana, leerArgumentos, nombreDePrueba, resumenError } from "./probar-escritura-publicidad-logica";

const EMPRESA = "22222222-2222-2222-2222-222222222222";
const CUENTA = "11111111-1111-1111-1111-111111111111";

describe("prueba de escritura de Publicidad (issue #257, paso 0)", () => {
  it("sin --aplicar es solo lectura; con --aplicar exige quién autorizó", () => {
    const base = [`--empresa=${EMPRESA}`, `--cuenta=${CUENTA}`, "--campana=123456"];
    expect(leerArgumentos(base)).toEqual({ empresaId: EMPRESA, cuentaMlId: CUENTA, campanaId: "123456", aplicar: false, autorizadoPor: null });
    expect(() => leerArgumentos([...base, "--aplicar"])).toThrow(/autorizado-por/);
    expect(leerArgumentos([...base, "--aplicar", "--autorizado-por=Ana Pérez"]).autorizadoPor).toBe("Ana Pérez");
  });

  it("rechaza ids mal escritos antes de llamar a nadie", () => {
    expect(() => leerArgumentos(["--empresa=x", `--cuenta=${CUENTA}`, "--campana=1"])).toThrow(/empresa/);
    expect(() => leerArgumentos([`--empresa=${EMPRESA}`, `--cuenta=${CUENTA}`, "--campana=12a"])).toThrow(/campana/);
  });

  it("el nombre de prueba agrega un sufijo y no se apila sobre una prueba sin revertir", () => {
    expect(nombreDePrueba("VENDEDOR")).toBe("VENDEDOR (prueba)");
    expect(() => nombreDePrueba("VENDEDOR (prueba)")).toThrow(/sin revertir/);
  });

  it("detecta cualquier cambio fuera del nombre", () => {
    const antes = camposDeCampana({ name: "A", status: "active", budget: 50000, roas_target: 8, strategy: "PROFITABILITY", otro: "x" });
    expect(antes).toEqual({ name: "A", status: "active", budget: "50000", roas_target: "8", strategy: "PROFITABILITY" });
    expect(cambiosInesperados(antes, { ...antes, name: "A (prueba)" })).toEqual([]);
    expect(cambiosInesperados(antes, { ...antes, status: "paused" })).toEqual(["status: active → paused"]);
  });

  it("el error de Mercado Libre se resume, nunca se imprime crudo", () => {
    expect(resumenError({ error: "forbidden", message: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES", status: 403, cause: [{ x: 1 }] })).toBe(
      "forbidden · PA_UNAUTHORIZED_RESULT_FROM_POLICIES"
    );
    expect(resumenError(null)).toBe("sin detalle");
  });
});
