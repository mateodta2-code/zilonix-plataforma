import { describe, expect, it } from "vitest";
import { componerMotivo } from "./motivos";

describe("componerMotivo", () => {
  it("acepta los motivos fijos", () => {
    expect(componerMotivo("no_estaba", "")).toBe("No estaba");
    expect(componerMotivo("direccion_errada", " Calle 5 ")).toBe("Dirección errada: Calle 5");
  });
  it("«otro» exige texto", () => {
    expect(componerMotivo("otro", "  ")).toBeNull();
    expect(componerMotivo("otro", "Se perdió")).toBe("Otro: Se perdió");
  });
  it("rechaza claves desconocidas o vacías", () => {
    expect(componerMotivo("", "x")).toBeNull();
    expect(componerMotivo("toString", "x")).toBeNull();
  });
});
