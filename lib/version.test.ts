import { describe, expect, it } from "vitest";
import { commitCorto, VERSION } from "./version";

describe("version", () => {
  it("sigue el formato semver (x.y.z)", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("commitCorto (issue #37)", () => {
  it("recorta un SHA largo a 7 caracteres", () => {
    expect(commitCorto("a1b2c3d4e5f6789012345678901234567890abcd")).toBe("a1b2c3d");
  });

  it("devuelve \"desconocido\" si el SHA viene vacío", () => {
    expect(commitCorto("")).toBe("desconocido");
  });

  it("devuelve \"desconocido\" si la variable no existe (undefined)", () => {
    expect(commitCorto(undefined)).toBe("desconocido");
  });
});
