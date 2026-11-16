import { describe, expect, it } from "vitest";
import { enmascararCorreo, resumenGlobal } from "./superadmin-vista";

describe("enmascararCorreo", () => {
  it("deja la primera letra y el dominio", () => {
    expect(enmascararCorreo("persona@ejemplo.test")).toBe("p***@ejemplo.test");
  });
  it("sin arroba válido no muestra nada", () => {
    expect(enmascararCorreo("sin-arroba")).toBe("***");
    expect(enmascararCorreo("@x.test")).toBe("***");
  });
});

describe("resumenGlobal", () => {
  it("cuenta activas, suspendidas y suma lo agregado", () => {
    const r = resumenGlobal([
      { estado: "activa", miembros: 3, cuentasMl: 2, cuentasFalabella: 1 },
      { estado: "suspendida", miembros: 1, cuentasMl: 0, cuentasFalabella: 0 },
      { estado: "activa", miembros: 2, cuentasMl: 1, cuentasFalabella: 0 },
    ]);
    expect(r).toEqual({ empresasActivas: 2, empresasSuspendidas: 1, miembros: 6, cuentasMl: 3, cuentasFalabella: 1 });
  });
});
