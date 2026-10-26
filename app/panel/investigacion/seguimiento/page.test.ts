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

  it("actions.ts pide inventario.modificar en las 4 acciones de escritura (agregar, quitar, marcar leída, guardar dato de página — issue #251)", () => {
    const contenido = contenidoDe("actions.ts");
    const coincidencias = contenido.match(/requierePermiso\(\s*usuario\.id,\s*empresa\.id,\s*"inventario",\s*"modificar"\s*\)/g) ?? [];
    // Corrección de Pablo (punto 7) — guardarDatoPaginaSeguimientoAction
    // Y guardarVariosDatosPaginaSeguimientoAction (la cola en lote)
    // ahora comparten UN SOLO chequeo (empresaConPermisoDeExtension) en
    // vez de tener el suyo cada una — sigue siendo 4 llamadas reales en
    // el archivo (agregar, quitar, marcar leída, el helper compartido),
    // nunca una por acción de extensión.
    expect(coincidencias.length).toBe(4);
  });
});

// Issue #251 (corrección de Pablo, punto 6) — chequeo estático del
// validador de la extensión: sin Postgres ni Clerk (los helpers de
// permiso/sesión no son triviales de montar en un test unitario), pero
// confirma que las reglas reales que pidió la revisión están en el
// código, no solo en la intención. El comportamiento real (acepta/
// rechaza un payload concreto) ya lo prueba indirectamente
// lib/seguimiento/seguimientos.test.ts contra Postgres real, llamando
// guardarDatoDePaginaSeguimiento con datos ya validados.
describe("datoPaginaSeguimientoValido — validador real de la extensión (issue #251, corrección de Pablo al punto 6)", () => {
  it("mlIdExterno e idsVisibles se validan con el patrón real de ids de Mercado Libre, no 'cualquier string no vacío'", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/PATRON_ID_ML_O_VENDEDOR\s*=\s*\/\^\(MCO\|MLA\|MLB\|MLM\|MLC\|MLU\|MPE\)\\d\+\$\|\^\\d\+\$\//);
  });

  it("inventario/vendidos/totalPublicaciones se validan con Number.isInteger y un rango real (0 a 1_000_000)", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/Number\.isInteger\(valor\)/);
    expect(contenido).toMatch(/valor\s*>=\s*0/);
    expect(contenido).toMatch(/valor\s*<=\s*1_000_000/);
  });

  it("idsVisibles tiene un tope real (100)", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/MAX_IDS_VISIBLES\s*=\s*100/);
    expect(contenido).toMatch(/idsVisibles\.length\s*<=\s*MAX_IDS_VISIBLES/);
  });

  it("leidoEn se valida como fecha ISO real, nunca futura, y con un tope de antigüedad (36h)", () => {
    const contenido = contenidoDe("actions.ts");
    expect(contenido).toMatch(/MAX_HORAS_LEIDO_EN\s*=\s*36/);
    expect(contenido).toMatch(/fecha\.getTime\(\)\s*>\s*ahoraMs/); // nunca en el futuro
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
