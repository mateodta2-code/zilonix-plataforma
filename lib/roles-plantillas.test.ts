import { describe, expect, it } from "vitest";
import {
  ACCIONES,
  esPeligroso,
  MODULOS,
  NOMBRES_PLANTILLA,
  PLANTILLAS,
  permisosDeDueno,
  permisosQueNoPuedeDar,
  plantillasQuePuedeDar,
  type Permiso,
} from "./roles-plantillas";

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
        "publicidad.consultar.todo",
        "promociones.consultar.todo",
        "promociones.aprobar.todo",
        "promociones.ejecutar.todo",
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
        "publicidad.consultar.todo",
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
        "publicidad.consultar.todo",
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

  it("publicidad y promociones son los módulos nuevos; publicidad solo da consultar en las plantillas (issue #254)", () => {
    expect([...MODULOS]).toEqual(["ventas", "inventario", "finanzas", "personas", "configuracion", "publicidad", "promociones"]);
    for (const nombre of ["Gerente", "Auxiliar", "Operaciones"] as const) {
      expect(PLANTILLAS[nombre].filter((p) => p.modulo === "publicidad")).toEqual([
        { modulo: "publicidad", accion: "consultar", alcance: "todo" },
      ]);
    }
    for (const nombre of ["Tecnología", "Contador", "Operador", "Proveedor", "Domiciliario"] as const) {
      expect(PLANTILLAS[nombre].some((p) => p.modulo === "publicidad")).toBe(false);
    }
  });

  it("promociones — solo Gerente (todo) y Operador (solo consultar) reciben algo de fábrica; el resto, nada", () => {
    expect(claves(PLANTILLAS.Gerente.filter((p) => p.modulo === "promociones"))).toEqual(
      ["promociones.consultar.todo", "promociones.aprobar.todo", "promociones.ejecutar.todo"].sort()
    );
    expect(PLANTILLAS.Operador.filter((p) => p.modulo === "promociones")).toEqual([{ modulo: "promociones", accion: "consultar", alcance: "todo" }]);
    for (const nombre of ["Auxiliar", "Tecnología", "Operaciones", "Contador", "Proveedor", "Domiciliario"] as const) {
      expect(PLANTILLAS[nombre].some((p) => p.modulo === "promociones")).toBe(false);
    }
  });

  it("promociones.ejecutar está en PERMISOS_PELIGROSOS (cambia precios reales en Mercado Libre)", () => {
    expect(esPeligroso("promociones", "ejecutar")).toBe(true);
    expect(esPeligroso("promociones", "consultar")).toBe(false);
    expect(esPeligroso("promociones", "aprobar")).toBe(false);
  });
});

describe("los roles que ya existían no cambiaron (issue #124)", () => {
  it("Operador — más 'promociones.consultar' (rama feat-promociones)", () => {
    expect(claves(PLANTILLAS.Operador)).toEqual(
      [
        "ventas.consultar.todo",
        "ventas.crear.todo",
        "ventas.modificar.todo",
        "inventario.consultar.todo",
        "inventario.modificar.todo",
        "promociones.consultar.todo",
      ].sort()
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

// Issue #124 — candado contra escalada al invitar: solo se puede dar
// un rol si quien invita ya tiene cada uno de sus permisos.
describe("qué roles puede dar quien invita (issue #124)", () => {
  it("Tecnología NO puede invitar a un Gerente, un Contador ni un Auxiliar", () => {
    const puede = plantillasQuePuedeDar(PLANTILLAS.Tecnología);
    expect(puede).not.toContain("Gerente");
    expect(puede).not.toContain("Contador");
    expect(puede).not.toContain("Auxiliar");
    expect(permisosQueNoPuedeDar(PLANTILLAS.Tecnología, PLANTILLAS.Gerente)).toContainEqual({ modulo: "finanzas", accion: "anular", alcance: "todo" });
  });

  it("Gerente sí puede invitar a un Auxiliar y a Operaciones", () => {
    const puede = plantillasQuePuedeDar(PLANTILLAS.Gerente);
    expect(puede).toContain("Auxiliar");
    expect(puede).toContain("Operaciones");
  });

  it("Dueño puede invitar con cualquier rol", () => {
    expect(plantillasQuePuedeDar(permisosDeDueno())).toEqual([...NOMBRES_PLANTILLA]);
  });

  it("si el rol ya existe en la empresa con más permisos que la plantilla, se compara contra el rol real", () => {
    const operacionesAjustado = [...PLANTILLAS.Operaciones, { modulo: "finanzas" as const, accion: "anular" as const, alcance: "todo" as const }];
    expect(plantillasQuePuedeDar(PLANTILLAS.Gerente)).toContain("Operaciones");
    expect(plantillasQuePuedeDar(PLANTILLAS.Auxiliar, { Operaciones: operacionesAjustado })).not.toContain("Operaciones");
  });

  it("alcance: \"todo\" cubre a \"propio\", pero \"propio\" no cubre a \"todo\"", () => {
    const todo = [{ modulo: "ventas", accion: "crear", alcance: "todo" }];
    const propio = [{ modulo: "ventas", accion: "crear", alcance: "propio" }];
    expect(permisosQueNoPuedeDar(todo, propio)).toEqual([]);
    expect(permisosQueNoPuedeDar(propio, todo)).toEqual(todo);
  });
});
