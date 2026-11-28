import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PLANTILLAS, permisosDeDueno } from "@/lib/roles-plantillas";
import { SECCIONES_FINANZAS, seccionesFinanzas } from "./secciones";

// Menú desplegable de Finanzas: cada sección existe, pide el mismo
// permiso que su página y solo sale para quien puede entrar.

const archivoPagina = (href: string) => join(process.cwd(), "app", ...href.split("/").filter(Boolean), "page.tsx");

describe("SECCIONES_FINANZAS", () => {
  it("cada sección apunta a una página real de /panel/finanzas", () => {
    for (const s of SECCIONES_FINANZAS) {
      expect(s.href.startsWith("/panel/finanzas"), s.href).toBe(true);
      expect(existsSync(archivoPagina(s.href)), s.href).toBe(true);
    }
  });

  it("cada sección declara el permiso que exige su página para entrar", () => {
    for (const s of SECCIONES_FINANZAS) {
      const codigo = readFileSync(archivoPagina(s.href), "utf8");
      // El primer requierePermiso de la página es el que decide si entra.
      const primero = codigo.match(/requierePermiso\([^)]*"finanzas",\s*"(\w+)"\)/);
      expect(primero?.[1], s.href).toBe(s.accion);
    }
  });

  it("incluye Ventas y utilidad, Por cobrar, Inversión en inventario y Configuración", () => {
    const etiquetas = SECCIONES_FINANZAS.map((s) => s.etiqueta);
    for (const e of ["Ventas y utilidad", "Por cobrar", "Inversión en inventario", "Configuración"]) {
      expect(etiquetas).toContain(e);
    }
  });

  // Pedido de Sharel (2026-11-28): Resumen fuera (sus cifras están en
  // Inicio), Falabella dentro de Por cobrar y Proveedores dentro de
  // Configuración — sin ítem propio, pero el menú las marca.
  it("Resumen, Conciliación Falabella y Proveedores no tienen ítem propio", () => {
    const etiquetas = SECCIONES_FINANZAS.map((s) => s.etiqueta);
    for (const e of ["Resumen", "Conciliación Falabella", "Proveedores"]) expect(etiquetas).not.toContain(e);
    expect(SECCIONES_FINANZAS.some((s) => s.href === "/panel/finanzas")).toBe(false);
  });

  it("Falabella cuelga de Por cobrar y Proveedores de Configuración", () => {
    const de = (etiqueta: string) => SECCIONES_FINANZAS.find((s) => s.etiqueta === etiqueta)?.otrasRutas;
    expect(de("Por cobrar")).toEqual(["/panel/finanzas/falabella"]);
    expect(de("Configuración")).toEqual(["/panel/finanzas/proveedores"]);
  });

  it("cada ruta colgada es una página real de /panel/finanzas", () => {
    for (const s of SECCIONES_FINANZAS) {
      for (const ruta of s.otrasRutas ?? []) expect(existsSync(archivoPagina(ruta)), ruta).toBe(true);
    }
  });
});

describe("seccionesFinanzas", () => {
  it("con finanzas/consultar salen todas las secciones", () => {
    expect(seccionesFinanzas(permisosDeDueno())).toHaveLength(SECCIONES_FINANZAS.length);
    expect(seccionesFinanzas([{ modulo: "finanzas", accion: "consultar" }])).toHaveLength(SECCIONES_FINANZAS.length);
  });

  it("sin permiso de finanzas no sale ninguna", () => {
    expect(seccionesFinanzas([])).toEqual([]);
    expect(seccionesFinanzas([{ modulo: "inventario", accion: "consultar" }])).toEqual([]);
  });

  it("no expone el campo interno de permiso al menú", () => {
    for (const s of seccionesFinanzas(PLANTILLAS.Gerente)) expect(Object.keys(s)).not.toContain("accion");
  });
});
