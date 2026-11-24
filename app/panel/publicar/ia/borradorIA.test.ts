import { describe, expect, it } from "vitest";
import { borrarBorradoresIA, DURACION_BORRADOR_IA_MS, guardarBorrador, leerBorrador } from "./borradorIA";

function almacenFalso() {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k: string) => datos.get(k) ?? null,
    setItem: (k: string, v: string) => void datos.set(k, v),
    removeItem: (k: string) => void datos.delete(k),
  };
}

describe("borrador de «Generación de imágenes para Meli» (2 horas)", () => {
  const T0 = 1_000_000;

  it("lo guardado se lee igual antes de las 2 horas", () => {
    const a = almacenFalso();
    guardarBorrador(a, "textos", { info: "bebedero" }, T0);
    expect(leerBorrador(a, "textos", T0 + DURACION_BORRADOR_IA_MS)).toEqual({ info: "bebedero" });
  });

  it("pasadas las 2 horas sin cambios, vence y se borra", () => {
    const a = almacenFalso();
    guardarBorrador(a, "textos", { info: "bebedero" }, T0);
    expect(leerBorrador(a, "textos", T0 + DURACION_BORRADOR_IA_MS + 1)).toBeNull();
    expect(a.datos.size).toBe(0);
  });

  it("cada cambio renueva el plazo", () => {
    const a = almacenFalso();
    guardarBorrador(a, "textos", { info: "a" }, T0);
    guardarBorrador(a, "textos", { info: "b" }, T0 + DURACION_BORRADOR_IA_MS - 10);
    expect(leerBorrador(a, "textos", T0 + DURACION_BORRADOR_IA_MS + 60_000)).toEqual({ info: "b" });
  });

  it("datos dañados, sin fecha o con fecha futura no se usan", () => {
    const a = almacenFalso();
    a.setItem("zilonix:publicar:ia:textos", "{no es json");
    expect(leerBorrador(a, "textos", T0)).toBeNull();
    a.setItem("zilonix:publicar:ia:textos", JSON.stringify({ datos: { info: "x" } }));
    expect(leerBorrador(a, "textos", T0)).toBeNull();
    a.setItem("zilonix:publicar:ia:textos", JSON.stringify({ ts: T0 + 5_000, datos: { info: "x" } }));
    expect(leerBorrador(a, "textos", T0)).toBeNull();
  });

  it("sin almacén (bloqueado) no falla, y si está lleno tampoco", () => {
    expect(leerBorrador(null, "textos", T0)).toBeNull();
    expect(() => guardarBorrador(null, "textos", {}, T0)).not.toThrow();
    const lleno = { ...almacenFalso(), setItem: () => { throw new Error("QuotaExceededError"); } };
    expect(() => guardarBorrador(lleno, "textos", {}, T0)).not.toThrow();
  });

  it("«Empezar de cero» borra las 3 partes y nada más", () => {
    const a = almacenFalso();
    for (const c of ["textos", "imagenes", "referencias"] as const) guardarBorrador(a, c, [1], T0);
    a.setItem("otra-cosa", "1");
    borrarBorradoresIA(a);
    expect([...a.datos.keys()]).toEqual(["otra-cosa"]);
  });
});
