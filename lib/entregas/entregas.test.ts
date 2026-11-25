import { describe, expect, it } from "vitest";
import { EntregaInvalidaError, validarDatosEntrega } from "./validar";

const base = { receptorNombre: " Ana ", direccion: " Calle 1 # 2-3 ", barrio: "", ciudad: " Cali ", telefono: " 3000000000 ", nota: "" };

describe("validarDatosEntrega", () => {
  it("recorta los espacios", () => {
    expect(validarDatosEntrega(base)).toMatchObject({ receptorNombre: "Ana", direccion: "Calle 1 # 2-3", ciudad: "Cali", telefono: "3000000000" });
  });
  it.each(["receptorNombre", "direccion", "ciudad", "telefono"] as const)("exige %s", (campo) => {
    expect(() => validarDatosEntrega({ ...base, [campo]: "  " })).toThrow(EntregaInvalidaError);
  });
  it("rechaza datos demasiado largos", () => {
    expect(() => validarDatosEntrega({ ...base, nota: "x".repeat(301) })).toThrow(EntregaInvalidaError);
  });
});
