import { describe, expect, it } from "vitest";
import { randomUUID } from "crypto";
import { esUuid } from "./validacion";

// Bug real en vivo (digest 960283135, staging): "sso-callback" colándose
// como el [id] de una ruta dinámica reventaba Postgres (22P02) al pasar
// directo a un eq(tabla.id, valor) contra una columna uuid. esUuid() es
// la única fuente de verdad para cortar eso antes de tocar la base.
describe("esUuid", () => {
  it("acepta un UUID v4 real", () => {
    expect(esUuid(randomUUID())).toBe(true);
  });

  it("acepta un UUID en mayúsculas (Postgres no distingue, tampoco esUuid)", () => {
    expect(esUuid(randomUUID().toUpperCase())).toBe(true);
  });

  it('rechaza "sso-callback" — la causa real del bug', () => {
    expect(esUuid("sso-callback")).toBe(false);
  });

  it("rechaza cadenas vacías, numéricas sueltas y casi-UUID", () => {
    expect(esUuid("")).toBe(false);
    expect(esUuid("12345")).toBe(false);
    expect(esUuid("not-a-uuid-at-all")).toBe(false);
    // Un UUID real con un carácter de menos no debe pasar por casualidad.
    expect(esUuid(randomUUID().slice(0, -1))).toBe(false);
  });
});
