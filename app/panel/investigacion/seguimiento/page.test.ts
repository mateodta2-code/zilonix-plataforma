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

// Issue #182 — la extensión (0.3.0, "Seguir en Zilonix") abre esta
// pantalla con ?agregar=<itemId MCO> o ?agregar_tienda=<sellerId
// numérico>. Mismo criterio que el resto de este archivo: chequeo
// estático de texto, sin montar React ni Postgres — la lógica real
// (buscarSeguimientoActivoPorMlId, agregarSeguimiento) ya la prueba
// lib/seguimiento/seguimientos.test.ts contra Postgres real.
describe("?agregar / ?agregar_tienda — la extensión agrega un seguimiento al abrir la pantalla (issue #182)", () => {
  it("page.tsx valida el FORMATO del id antes de llamar a procesarAgregarPorQuery (nunca confía en el query param tal cual)", () => {
    const contenido = contenidoDe("page.tsx");
    expect(contenido).toMatch(/PATRON_ID_ITEM\s*=\s*\/\^MCO\\d\+\$\//);
    expect(contenido).toMatch(/PATRON_ID_VENDEDOR\s*=\s*\/\^\\d\+\$\//);
    expect(contenido).toMatch(/procesarAgregarPorQuery\(/);

    // Orden real: el chequeo de formato tiene que pasar ANTES que la
    // llamada — nunca al revés, nunca en paralelo.
    const idxChequeoItem = contenido.indexOf("PATRON_ID_ITEM.test(searchParams.agregar)");
    const idxLlamadaProducto = contenido.indexOf('procesarAgregarPorQuery(empresa.id, usuario.id, { tipo: "producto"');
    expect(idxChequeoItem).toBeGreaterThan(-1);
    expect(idxLlamadaProducto).toBeGreaterThan(idxChequeoItem);
  });

  it("actions.ts: procesarAgregarPorQuery pide inventario.modificar, igual que las demás acciones de escritura", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/requierePermiso\(\s*usuarioId,\s*empresaId,\s*"inventario",\s*"modificar"\s*\)/);
  });

  it("actions.ts: todos los redirects de procesarAgregarPorQuery son REPLACE (nunca push) — para que F5 o 'volver atrás' no vuelvan a agregar", () => {
    const contenido = contenidoDe("actions.ts");
    const inicio = contenido.indexOf("export async function procesarAgregarPorQuery");
    const fin = contenido.indexOf("export async function eliminarSeguimientoAction");
    expect(inicio).toBeGreaterThan(-1);
    const bloque = contenido.slice(inicio, fin);

    const totalRedirects = (bloque.match(/redirect\(/g) ?? []).length;
    const redirectsConReplace = (bloque.match(/redirect\([\s\S]*?,\s*RedirectType\.replace\s*\)/g) ?? []).length;
    expect(totalRedirects).toBeGreaterThanOrEqual(4); // sin permiso, ya existía, error de agregarSeguimiento, éxito
    expect(redirectsConReplace).toBe(totalRedirects);
  });
});
