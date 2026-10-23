import { describe, expect, it } from "vitest";
import { ACCIONES, MODULOS, NOMBRES_PLANTILLA, PLANTILLAS, permisosDeDueno, type Permiso } from "./roles-plantillas";

// Issue #124 (Z-FIN-02) — los permisos de cada plantilla se escriben
// acá a mano, uno por uno, a propósito: si alguien toca la plantilla
// (o el helper que la arma) sin querer, esta prueba lo dice. No
// necesita Postgres — son datos puros.
function claves(permisos: Permiso[]): string[] {
  return permisos.map((p) => `${p.modulo}.${p.accion}.${p.alcance}`).sort();
}

function sinDuplicados(permisos: Permiso[]): boolean {
  return new Set(claves(permisos)).size === permisos.length;
}

describe("roles nuevos de Zilonix Seller (issue #124)", () => {
  it("Gerente: todo en ventas/inventario/finanzas; personas sin anular ni autorizar; configuracion solo consultar y modificar", () => {
    expect(claves(PLANTILLAS.Gerente)).toEqual(
      [
        "ventas.consultar.todo",
        "ventas.crear.todo",
        "ventas.modificar.todo",
        "ventas.anular.todo",
        "ventas.autorizar.todo",
        "inventario.consultar.todo",
        "inventario.crear.todo",
        "inventario.modificar.todo",
        "inventario.anular.todo",
        "inventario.autorizar.todo",
        "finanzas.consultar.todo",
        "finanzas.crear.todo",
        "finanzas.modificar.todo",
        "finanzas.anular.todo",
        "finanzas.autorizar.todo",
        "personas.consultar.todo",
        "personas.crear.todo",
        "personas.modificar.todo",
        "configuracion.consultar.todo",
        "configuracion.modificar.todo",
      ].sort()
    );
    expect(sinDuplicados(PLANTILLAS.Gerente)).toBe(true);
  });

  it("Auxiliar (comodín): consultar, crear y modificar en ventas/inventario/finanzas — sin anular, autorizar, personas ni configuracion", () => {
    expect(claves(PLANTILLAS.Auxiliar)).toEqual(
      [
        "ventas.consultar.todo",
        "ventas.crear.todo",
        "ventas.modificar.todo",
        "inventario.consultar.todo",
        "inventario.crear.todo",
        "inventario.modificar.todo",
        "finanzas.consultar.todo",
        "finanzas.crear.todo",
        "finanzas.modificar.todo",
      ].sort()
    );
    expect(PLANTILLAS.Auxiliar.some((p) => p.accion === "anular" || p.accion === "autorizar")).toBe(false);
    expect(sinDuplicados(PLANTILLAS.Auxiliar)).toBe(true);
  });

  it("Tecnología: configuracion y personas, ventas/inventario solo consultar, nada de finanzas", () => {
    expect(claves(PLANTILLAS.Tecnología)).toEqual(
      [
        "configuracion.consultar.todo",
        "configuracion.modificar.todo",
        "personas.consultar.todo",
        "personas.crear.todo",
        "personas.modificar.todo",
        "ventas.consultar.todo",
        "inventario.consultar.todo",
      ].sort()
    );
    expect(PLANTILLAS.Tecnología.some((p) => p.modulo === "finanzas")).toBe(false);
    expect(sinDuplicados(PLANTILLAS.Tecnología)).toBe(true);
  });

  it("Operaciones: ventas sin anular; inventario con anular; nada de finanzas", () => {
    expect(claves(PLANTILLAS.Operaciones)).toEqual(
      [
        "ventas.consultar.todo",
        "ventas.crear.todo",
        "ventas.modificar.todo",
        "inventario.consultar.todo",
        "inventario.crear.todo",
        "inventario.modificar.todo",
        "inventario.anular.todo",
      ].sort()
    );
    expect(PLANTILLAS.Operaciones.some((p) => p.modulo === "finanzas")).toBe(false);
    expect(sinDuplicados(PLANTILLAS.Operaciones)).toBe(true);
  });

  it("los 5 roles confirmados por Mateo se pueden elegir al invitar", () => {
    for (const nombre of ["Gerente", "Auxiliar", "Tecnología", "Contador", "Operaciones"]) {
      expect(NOMBRES_PLANTILLA).toContain(nombre);
    }
  });

  it("no se agregó ningún módulo nuevo (despachos y promociones llegan con sus pantallas)", () => {
    expect([...MODULOS]).toEqual(["ventas", "inventario", "finanzas", "personas", "configuracion"]);
  });
});

describe("los roles que ya existían no cambiaron (issue #124)", () => {
  it("Operador", () => {
    expect(claves(PLANTILLAS.Operador)).toEqual(
      ["ventas.consultar.todo", "ventas.crear.todo", "ventas.modificar.todo", "inventario.consultar.todo", "inventario.modificar.todo"].sort()
    );
  });

  it("Contador", () => {
    expect(claves(PLANTILLAS.Contador)).toEqual(
      [
        "finanzas.consultar.todo",
        "finanzas.crear.todo",
        "finanzas.modificar.todo",
        "finanzas.autorizar.todo",
        "ventas.consultar.todo",
        "inventario.consultar.todo",
      ].sort()
    );
  });

  it("Proveedor y Domiciliario siguen sin ningún permiso", () => {
    expect(PLANTILLAS.Proveedor).toEqual([]);
    expect(PLANTILLAS.Domiciliario).toEqual([]);
  });

  it("Dueño sigue con todas las acciones sobre todos los módulos", () => {
    const dueno = permisosDeDueno();
    expect(dueno).toHaveLength(MODULOS.length * ACCIONES.length);
    expect(sinDuplicados(dueno)).toBe(true);
    expect(dueno.every((p) => p.alcance === "todo")).toBe(true);
  });

  it("toda plantilla tiene su nombre en NOMBRES_PLANTILLA y viceversa", () => {
    expect(Object.keys(PLANTILLAS).sort()).toEqual([...NOMBRES_PLANTILLA].sort());
  });
});
