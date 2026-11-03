import { describe, expect, it } from "vitest";
import { etiquetaEstadoItemMl, etiquetaPublicacionCuenta } from "./estado-publicacion";

describe("etiquetaEstadoItemMl — traducción de status de Mercado Libre", () => {
  it("traduce los 5 estados documentados", () => {
    expect(etiquetaEstadoItemMl("active")).toBe("Activa");
    expect(etiquetaEstadoItemMl("paused")).toBe("Pausada");
    expect(etiquetaEstadoItemMl("closed")).toBe("Finalizada");
    expect(etiquetaEstadoItemMl("under_review")).toBe("En revisión");
    expect(etiquetaEstadoItemMl("inactive")).toBe("Inactiva");
  });

  it("nunca muestra el código crudo en inglés para un estado no mapeado", () => {
    const etiqueta = etiquetaEstadoItemMl("payment_required");
    expect(etiqueta).not.toBe("payment_required");
    expect(etiqueta).toContain("payment_required"); // visible para diagnóstico, pero no SOLO el código
  });

  it("sin status (null/undefined): texto genérico, nunca lanza", () => {
    expect(etiquetaEstadoItemMl(null)).toBe("Estado desconocido");
    expect(etiquetaEstadoItemMl(undefined)).toBe("Estado desconocido");
  });
});

describe("etiquetaPublicacionCuenta — distingue sin verificar de activo real", () => {
  it("sin consultar todavía el estado real: 'Publicado (sin verificar)'", () => {
    expect(etiquetaPublicacionCuenta(null)).toBe("Publicado (sin verificar)");
    expect(etiquetaPublicacionCuenta(undefined)).toBe("Publicado (sin verificar)");
  });

  it("estado real activo: 'Publicado y activo'", () => {
    expect(etiquetaPublicacionCuenta("active")).toBe("Publicado y activo");
  });

  it("estado real distinto de activo: etiqueta en español, nunca 'activo' inventado", () => {
    expect(etiquetaPublicacionCuenta("paused")).toBe("Publicado — Pausada");
    expect(etiquetaPublicacionCuenta("closed")).toBe("Publicado — Finalizada");
  });
});
