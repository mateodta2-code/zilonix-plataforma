import { describe, expect, it } from "vitest";
import { datoPaginaSeguimientoValido } from "./validarDatoPagina";

function payloadProductoBase(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tipoSeguimiento: "producto",
    mlIdExterno: "MCO111",
    inventario: 10,
    inventarioAproximado: false,
    vendidos: 5,
    vendidosExacto: true,
    titulo: "Cargador HP 65W original",
    precio: 89900,
    leidoEn: new Date().toISOString(),
    ...extra,
  };
}

describe("datoPaginaSeguimientoValido — producto (issue #251/#252)", () => {
  it("payload completo (con titulo/precio) es válido", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase())).toBe(true);
  });

  // Issue #252 (revisión de Pablo, punto 3) — bug real: la extensión
  // 0.3.30 nunca mandaba `titulo`/`precio` (quedaban `undefined`, no
  // `null`) — antes de este fix, eso descartaba el payload ENTERO,
  // perdiendo también inventario y vendidos.
  it("sin titulo ni precio (la extensión 0.3.30, antes del #252): sigue siendo válido, nunca descarta inventario/vendidos", () => {
    const payload = payloadProductoBase();
    delete payload.titulo;
    delete payload.precio;
    expect(datoPaginaSeguimientoValido(payload)).toBe(true);
    // Normalizado a null de verdad, nunca se queda en undefined.
    expect((payload as { titulo: unknown }).titulo).toBeNull();
    expect((payload as { precio: unknown }).precio).toBeNull();
  });

  it("titulo/precio explícitamente null también es válido (forma nueva, ya normalizada)", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ titulo: null, precio: null }))).toBe(true);
  });

  it("titulo vacío o solo espacios: inválido (no es basura segura, pero tampoco un título real)", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ titulo: "" }))).toBe(false);
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ titulo: "   " }))).toBe(false);
  });

  it("titulo demasiado largo (> 300, ej. un selector equivocado trayendo HTML entero): inválido", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ titulo: "x".repeat(301) }))).toBe(false);
  });

  it("precio negativo, no numérico, o fuera de rango: inválido", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ precio: -1 }))).toBe(false);
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ precio: "89900" }))).toBe(false);
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ precio: 2_000_000_000 }))).toBe(false);
  });

  it("mlIdExterno con formato inválido: inválido, sin importar el resto", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ mlIdExterno: "no-es-un-id" }))).toBe(false);
  });

  it("leidoEn futuro o demasiado viejo (> 36h): inválido", () => {
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ leidoEn: new Date(Date.now() + 60_000).toISOString() }))).toBe(false);
    expect(datoPaginaSeguimientoValido(payloadProductoBase({ leidoEn: new Date(Date.now() - 37 * 60 * 60 * 1000).toISOString() }))).toBe(false);
  });
});

describe("datoPaginaSeguimientoValido — tienda (issue #251)", () => {
  it("payload de tienda válido", () => {
    expect(
      datoPaginaSeguimientoValido({
        tipoSeguimiento: "tienda",
        mlIdExterno: "145150422",
        totalPublicaciones: 23,
        idsVisibles: ["MCO1", "MCO2"],
        leidoEn: new Date().toISOString(),
      })
    ).toBe(true);
  });

  it("un id visible con formato inválido tumba todo el payload", () => {
    expect(
      datoPaginaSeguimientoValido({
        tipoSeguimiento: "tienda",
        mlIdExterno: "145150422",
        totalPublicaciones: 23,
        idsVisibles: ["MCO1", "basura"],
        leidoEn: new Date().toISOString(),
      })
    ).toBe(false);
  });
});

describe("datoPaginaSeguimientoValido — casos generales", () => {
  it("payload nulo, no-objeto, o tipoSeguimiento desconocido: inválido", () => {
    expect(datoPaginaSeguimientoValido(null)).toBe(false);
    expect(datoPaginaSeguimientoValido("texto")).toBe(false);
    expect(datoPaginaSeguimientoValido({ tipoSeguimiento: "otra-cosa" })).toBe(false);
  });
});
