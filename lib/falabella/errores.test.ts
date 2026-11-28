import { describe, expect, it } from "vitest";
import { traducirErrorFalabella } from "./errores";

describe("traducirErrorFalabella", () => {
  it("campo vacío", () => {
    expect(traducirErrorFalabella("Field &#039;CapacidadDeCarga&#039; cannot be empty")).toContain("Falta llenar «CapacidadDeCarga»");
  });
  it("opción inválida", () => {
    expect(traducirErrorFalabella("Field 'Modelo' with value 'generico' does not appear to be a valid option.")).toBe(
      "«generico» no es una opción válida para «Modelo». Elige una de la lista que ofrece Falabella."
    );
  });
  it("deja igual lo desconocido", () => {
    expect(traducirErrorFalabella("Algo raro")).toBe("Algo raro");
  });
});
