import { describe, expect, it } from "vitest";
import { urlFotoGrandeMl } from "./imagen-ml";

// Mismos casos reales ya confirmados en extension/lectores/mercadolibre.test.ts
// (urlFotoGrande) — mismo regex exacto, solo reusado acá.
describe("urlFotoGrandeMl", () => {
  it("cambia el sufijo de tamaño (-I) por -O, antes de la extensión", () => {
    expect(urlFotoGrandeMl("https://http2.mlstatic.com/D_NQ_NP_123456-MCO12345-I.jpg")).toBe("https://http2.mlstatic.com/D_NQ_NP_123456-MCO12345-O.jpg");
  });

  // Mismo comportamiento real que urlFotoGrande en la extensión: el
  // reemplazo solo conserva la extensión (grupo 1), nunca el query
  // string — no es un descuido, es el mismo regex ya confirmado ahí.
  it("funciona con cualquier letra de sufijo (F) y descarta el query string, igual que la extensión", () => {
    expect(urlFotoGrandeMl("https://http2.mlstatic.com/foo-F.webp?v=2")).toBe("https://http2.mlstatic.com/foo-O.webp");
  });

  it("sin sufijo de tamaño reconocible, devuelve la URL tal cual (nunca rompe ni inventa una)", () => {
    expect(urlFotoGrandeMl("https://http2.mlstatic.com/sin-sufijo.jpg")).toBe("https://http2.mlstatic.com/sin-sufijo.jpg");
  });
});
