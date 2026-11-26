import { describe, expect, it } from "vitest";
import { diasSinIngresar, esInactiva, leerDiasInactividad, ordenarPorIngreso } from "./superadmin-inactivas";

const ahora = new Date("2026-12-31T12:00:00Z");
const haceDias = (d: number) => new Date(ahora.getTime() - d * 24 * 3600_000);

describe("empresas inactivas", () => {
  it("solo acepta 7, 15 o 30 días", () => {
    expect(leerDiasInactividad("15")).toBe(15);
    expect(leerDiasInactividad("10")).toBeNull();
    expect(leerDiasInactividad(undefined)).toBeNull();
  });

  it("inactiva = activa y sin entrar más de N días, o sin registro; una suspendida nunca", () => {
    expect(esInactiva({ estado: "activa", ultimoIngresoTs: haceDias(8) }, 7, ahora)).toBe(true);
    expect(esInactiva({ estado: "activa", ultimoIngresoTs: haceDias(6) }, 7, ahora)).toBe(false);
    expect(esInactiva({ estado: "activa", ultimoIngresoTs: null }, 30, ahora)).toBe(true);
    expect(esInactiva({ estado: "suspendida", ultimoIngresoTs: haceDias(90) }, 7, ahora)).toBe(false);
  });

  it("ordena la que lleva más tiempo sin entrar primero, sin registro antes que todas", () => {
    const lista = [{ n: "a", ultimoIngresoTs: haceDias(10) }, { n: "b", ultimoIngresoTs: null }, { n: "c", ultimoIngresoTs: haceDias(40) }];
    expect(ordenarPorIngreso(lista).map((x) => x.n)).toEqual(["b", "c", "a"]);
  });

  it("días sin ingresar", () => {
    expect(diasSinIngresar(haceDias(3.5), ahora)).toBe(3);
    expect(diasSinIngresar(null, ahora)).toBeNull();
  });
});
