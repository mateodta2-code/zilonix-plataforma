import { describe, expect, it } from "vitest";
import { DatosEntregaInvalidosError, normalizarDatosEntrega } from "./datos";

const base = { receptorNombre: " Ana Pérez ", direccion: " Calle 1 # 2-3 ", barrio: " ", ciudad: "Medellín", telefono: "300 123 4567", nota: "" };

describe("normalizarDatosEntrega", () => {
  it("recorta y deja barrio y nota vacíos como null", () => {
    expect(normalizarDatosEntrega(base)).toEqual({ receptorNombre: "Ana Pérez", direccion: "Calle 1 # 2-3", barrio: null, ciudad: "Medellín", telefono: "300 123 4567", nota: null });
  });
  it.each(["receptorNombre", "direccion", "ciudad", "telefono"] as const)("rechaza si falta %s", (campo) => {
    expect(() => normalizarDatosEntrega({ ...base, [campo]: "  " })).toThrow(DatosEntregaInvalidosError);
  });
  it("rechaza un teléfono demasiado corto", () => {
    expect(() => normalizarDatosEntrega({ ...base, telefono: "123" })).toThrow("teléfono");
  });
});
