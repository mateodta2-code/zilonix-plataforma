import { describe, expect, it } from "vitest";
import { textoErrorParaGuardar, traducirErrorValidacion } from "./publicar-errores-validacion";
import { FIXTURE_VALIDACION } from "./publicar-errores-validacion.fixture";

describe("traducirErrorValidacion", () => {
  it("separa bloqueos y avisos y traduce los códigos conocidos", () => {
    const r = traducirErrorValidacion(FIXTURE_VALIDACION)!;
    expect(r.bloqueos).toHaveLength(1);
    expect(r.bloqueos[0].mensaje).toBe("Esta categoría exige el código de barras (GTIN). Llénalo o marca que el producto no tiene código.");
    expect(r.bloqueos[0].campo).toBe("Características");
    expect(r.avisos.map((a) => a.mensaje)).toEqual([
      "Falta el campo ‹Tipo de producto›.",
      "Tu cuenta maneja stock en varias bodegas; la cantidad se toma de allá. No tienes que hacer nada.",
    ]);
    expect(r.avisos[1].campo).toBe("Cantidad disponible");
  });

  it("código desconocido: conserva el mensaje de ML y marca desconocido", () => {
    const r = traducirErrorValidacion(
      JSON.stringify({ error: "validation_error", status: 400, cause: [{ type: "error", code: "item.raro", message: "Algo raro", references: [] }] }),
    )!;
    expect(r.bloqueos[0]).toMatchObject({ mensaje: "Algo raro", codigo: "item.raro", desconocido: true });
  });

  it("devuelve null si no es un error de validación", () => {
    expect(traducirErrorValidacion("texto cualquiera")).toBeNull();
    expect(traducirErrorValidacion(JSON.stringify({ message: "x", status: 403 }))).toBeNull();
  });

  it("nunca sugiere reconectar la cuenta", () => {
    const r = traducirErrorValidacion(FIXTURE_VALIDACION)!;
    const todo = [...r.bloqueos, ...r.avisos].map((c) => c.mensaje).join(" ").toLowerCase();
    expect(todo).not.toContain("reconect");
  });
});

describe("textoErrorParaGuardar", () => {
  it("guarda completo un validation_error largo y recorta el resto a 2000", () => {
    expect(textoErrorParaGuardar(FIXTURE_VALIDACION)).toBe(FIXTURE_VALIDACION);
    expect(textoErrorParaGuardar("x".repeat(5000))).toHaveLength(2000);
  });
});
