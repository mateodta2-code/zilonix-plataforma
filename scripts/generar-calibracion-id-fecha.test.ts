import { describe, expect, it } from "vitest";
import { decidirPuntoCompetidor, prefijoDeId } from "./generar-calibracion-id-fecha-logica";

// Issue #262 (revisión de Pablo, punto BLOQUEANTE) — decidirPuntoCompetidor
// es la decisión PURA (sin Postgres) que extrae puntosDeCompetidores;
// se prueba sola para no necesitar DATABASE_URL_APP, mismo criterio
// que scripts/comparar-conteos-logica.ts.
describe("decidirPuntoCompetidor — issue #262 (nunca la fecha del ítem ganador para un catálogo)", () => {
  it('recursoMl "item": usa fechaCreacion (del ítem puntual), nunca omitido', () => {
    const resultado = decidirPuntoCompetidor("MCO111111111", "item", [{ publicaciones: { fechaCreacion: "2024-01-01T00:00:00.000Z" } }]);
    expect(resultado).toEqual({ punto: { id: "MCO111111111", tipo: "item", fecha: "2024-01-01T00:00:00.000Z" }, omitido: false });
  });

  it('recursoMl "item" sin ninguna fecha confirmada todavía: sin punto, nunca omitido (no hay nada que "omitir", solo falta el dato)', () => {
    const resultado = decidirPuntoCompetidor("MCO111111111", "item", [{ publicaciones: null }]);
    expect(resultado).toEqual({ punto: null, omitido: false });
  });

  it('recursoMl "product": usa fechaCreacionCatalogo (del catálogo real), nunca fechaCreacion', () => {
    const resultado = decidirPuntoCompetidor("MCO999999999", "product", [{ publicaciones: { fechaCreacionCatalogo: "2025-03-15T00:00:00.000Z" } }]);
    expect(resultado).toEqual({ punto: { id: "MCO999999999", tipo: "product", fecha: "2025-03-15T00:00:00.000Z" }, omitido: false });
  });

  // El caso real del bug bloqueante: una fila (real o simulando una
  // fila vieja de antes del fix de lector.ts) con `fechaCreacion` del
  // ítem GANADOR de ese catálogo, pero SIN `fechaCreacionCatalogo`
  // real todavía — nunca debe colarse como si fuera la fecha del
  // catálogo, aunque `fechaCreacion` SÍ tenga un valor ahí.
  it('recursoMl "product" con fechaCreacion (del ítem ganador, nunca del catálogo) pero SIN fechaCreacionCatalogo: omitido, NUNCA usa fechaCreacion', () => {
    const resultado = decidirPuntoCompetidor("MCO999999999", "product", [{ publicaciones: { fechaCreacion: "2024-06-01T00:00:00.000Z" } }]);
    expect(resultado).toEqual({ punto: null, omitido: true });
  });

  it('recursoMl "product" sin ninguna fecha (ni siquiera la del ítem ganador): también omitido', () => {
    const resultado = decidirPuntoCompetidor("MCO999999999", "product", [{ publicaciones: null }]);
    expect(resultado).toEqual({ punto: null, omitido: true });
  });

  it("toma la primera foto con la fecha confirmada entre varias (nunca revienta con un historial largo)", () => {
    const resultado = decidirPuntoCompetidor("MCO111111111", "item", [
      { publicaciones: null },
      { publicaciones: { fechaCreacion: "2024-01-01T00:00:00.000Z" } },
      { publicaciones: { fechaCreacion: "2024-01-01T00:00:00.000Z" } }, // misma fecha real en las fotos siguientes — nunca cambia
    ]);
    expect(resultado.punto?.fecha).toBe("2024-01-01T00:00:00.000Z");
  });
});

describe("prefijoDeId", () => {
  it("separa el prefijo de país de los dígitos del id", () => {
    expect(prefijoDeId("MCO64541261")).toBe("MCO");
  });

  it("un id sin el patrón prefijo+dígitos -> null", () => {
    expect(prefijoDeId("no-es-un-id")).toBeNull();
  });
});
