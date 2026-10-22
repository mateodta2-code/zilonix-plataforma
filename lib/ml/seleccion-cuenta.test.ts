import { describe, expect, it } from "vitest";
import { CUENTA_TODAS, resolverCuentaSeleccionada, type CuentaMlOpcion } from "./seleccion-cuenta";

const cuentas: CuentaMlOpcion[] = [
  { id: "cuenta-a", apodo: "VENDEDOR_A" },
  { id: "cuenta-b", apodo: "VENDEDOR_B" },
];

describe("resolverCuentaSeleccionada (issue #54)", () => {
  it("sin query devuelve \"todas\"", () => {
    expect(resolverCuentaSeleccionada(null, cuentas)).toBe(CUENTA_TODAS);
    expect(resolverCuentaSeleccionada(undefined, cuentas)).toBe(CUENTA_TODAS);
    expect(resolverCuentaSeleccionada("", cuentas)).toBe(CUENTA_TODAS);
  });

  it("un id válido (de la lista permitida) se devuelve tal cual", () => {
    expect(resolverCuentaSeleccionada("cuenta-b", cuentas)).toBe("cuenta-b");
  });

  it("un id ajeno (no está en la lista de la empresa activa) cae a \"todas\"", () => {
    expect(resolverCuentaSeleccionada("cuenta-de-otra-empresa", cuentas)).toBe(CUENTA_TODAS);
  });

  it("un valor basura en la URL cae a \"todas\"", () => {
    expect(resolverCuentaSeleccionada("<script>alert(1)</script>", cuentas)).toBe(CUENTA_TODAS);
  });

  it("sin ninguna cuenta permitida, cualquier id cae a \"todas\"", () => {
    expect(resolverCuentaSeleccionada("cuenta-a", [])).toBe(CUENTA_TODAS);
  });
});
