import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { PLANTILLAS, permisosDeDueno, tienePermiso } from "@/lib/roles-plantillas";

// Issue #175 — "con prueba de permiso (solo dueño)". Dos pruebas
// complementarias, ninguna necesita Postgres:
// 1) que la página de verdad llame al candado configuracion.autorizar
//    (mismo que ya usa /panel/roles para "solo Dueño").
// 2) que ese permiso puntual sea, de verdad, exclusivo del Dueño hoy
//    — ninguna plantilla de rol lo concede (lib/roles-plantillas.ts).
//    Si algún día una plantilla empezara a incluirlo, esta prueba
//    avisa que "solo Dueño" dejó de ser cierto para esta pantalla.
describe("/panel/investigacion/diagnostico — solo Dueño (issue #175)", () => {
  it("la página llama requierePermiso(usuario.id, empresa.id, \"configuracion\", \"autorizar\")", () => {
    const contenido = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(contenido).toMatch(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"configuracion",\s*"autorizar"\s*\)/);
  });

  it("configuracion.autorizar es exclusivo del Dueño: ninguna plantilla de rol lo concede hoy", () => {
    for (const [nombre, permisos] of Object.entries(PLANTILLAS)) {
      expect(tienePermiso(permisos, "configuracion", "autorizar"), `la plantilla "${nombre}" ya tiene configuracion.autorizar`).toBe(false);
    }
    expect(tienePermiso(permisosDeDueno(), "configuracion", "autorizar")).toBe(true);
  });
});
