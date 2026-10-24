import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// Issue #175, punto 7 — chequeo estático (sin Postgres, sin montar
// React): confirma que cada archivo real llama al candado de permisos
// que dice usar. La lógica de negocio real que estos archivos delegan
// (agregar/listar/marcar leída) ya la prueba lib/seguimiento/seguimientos.test.ts
// contra Postgres real.
function contenidoDe(archivo: string): string {
  return readFileSync(join(__dirname, archivo), "utf8");
}

describe("/panel/investigacion/seguimiento — mismo permiso que Investigación para ver, 'modificar' para escribir (issue #175)", () => {
  it("page.tsx pide inventario.consultar (ver la lista y las alertas)", () => {
    expect(contenidoDe("page.tsx")).toMatch(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"consultar"\s*\)/);
  });

  it("[id]/page.tsx (detalle) pide inventario.consultar", () => {
    expect(contenidoDe("[id]/page.tsx")).toMatch(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"consultar"\s*\)/);
  });

  it("actions.ts pide inventario.modificar en las 3 acciones de escritura (agregar, quitar, marcar leída)", () => {
    const contenido = contenidoDe("actions.ts");
    const coincidencias = contenido.match(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"modificar"\s*\)/g) ?? [];
    expect(coincidencias.length).toBe(3);
  });
});
