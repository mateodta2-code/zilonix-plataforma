import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #251 (fix "aproximados siempre visibles") — content.js es un
// content script clásico (IIFE sin "type": "module" en manifest.json,
// igual que background.js — ver background.test.ts) que lee
// window.ZilonixUtilidades/ZilonixSeguridad/ZilonixLectorActivo/
// ZilonixAproximados/ZilonixCalibracion y arranca solo al cargar
// (reescanear() + MutationObserver + setInterval, todos sin exponer
// nada). Para poder probar bloqueAnalisisAproximado (la función pura
// detrás del bloque "Análisis aprox." del popup) sin un navegador
// real, content.js exporta esa función con el mismo patrón dual
// module.exports/window.X que ya usan extension/utilidades.js,
// extension/seguridad.js y extension/lectores/aproximados.js — nunca
// se exporta nada que dependa de document/chrome real.
//
// `lector.tipoDePagina` se mockea devolviendo `null`: así reescanear()
// (que SÍ corre apenas se importa el archivo) nunca llega a tocar
// document/chrome de verdad — alcanza con los stubs mínimos de abajo
// (document.body, MutationObserver, location.href) para que el import
// no reviente, sin necesitar jsdom.
const CALIBRACION_PRUEBA = { factorVendidosFull: 2.2, factorVendidosSinFull: 1.55, puntos: [] };

async function cargarContentFresco() {
  vi.resetModules();
  (globalThis as unknown as { window: unknown }).window = globalThis;
  (globalThis as unknown as { location: { href: string } }).location = { href: "https://articulo.mercadolibre.com.co/MCO-123456789-reloj" };
  (globalThis as unknown as { document: { body: unknown } }).document = { body: {} };
  (globalThis as unknown as { MutationObserver: unknown }).MutationObserver = class {
    observe() {
      // nunca se dispara en esta prueba — reescanear() ya volvió antes de llegar acá
    }
  };
  (globalThis as unknown as { chrome: unknown }).chrome = undefined;
  (globalThis as unknown as Record<string, unknown>).ZilonixUtilidades = {};
  // Issue #174 — mismo patrón dual que seguridad.test.ts: se importa
  // el módulo real (no un mock) para que textoCampo() escape de
  // verdad, igual que en producción.
  const seguridad = await import("./seguridad.js");
  (globalThis as unknown as Record<string, unknown>).ZilonixSeguridad = seguridad;
  (globalThis as unknown as Record<string, unknown>).ZilonixLectorActivo = {
    sitio: "Mercado Libre Colombia",
    tipoDePagina: () => null, // reescanear() corta ahí mismo — nunca llega a leer document de verdad
  };
  const aproximados = await import("./lectores/aproximados.js");
  (globalThis as unknown as Record<string, unknown>).ZilonixAproximados = aproximados;
  (globalThis as unknown as Record<string, unknown>).ZilonixCalibracion = CALIBRACION_PRUEBA;

  return (await import("./content.js")) as unknown as { bloqueAnalisisAproximado: (datos: Record<string, unknown>) => string };
}

describe("content.js — bloqueAnalisisAproximado, issue #251 (fix 'aproximados siempre visibles')", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin vendidos (0 o no visible en ML): el bloque SIEMPRE se renderiza, nunca \"\" — 'Vendidos estimados' explica por qué falta", async () => {
    const mod = await cargarContentFresco();
    const html = mod.bloqueAnalisisAproximado({ vendidos: null, vendidosExacto: false, esFull: null, precio: 100_000, moneda: "COP", dateCreated: null, itemId: "MCO123456789" });
    expect(html).not.toBe("");
    expect(html).toContain("Análisis aprox.");
    expect(html).toContain("Vendidos estimados");
    expect(html).toContain("Sin dato (0 o no visible en ML)");
    // El resto de las filas también caen a "Sin dato", nunca quedan
    // vacías ni con un número inventado.
    expect(html).toContain("Antigüedad");
    expect(html).toContain("Ventas/mes");
    expect(html).toContain("Facturación/mes");
  });

  it("con vendidos (el piso '+N' de la ficha): sigue mostrando el estimado real, sin regresión", async () => {
    const mod = await cargarContentFresco();
    const html = mod.bloqueAnalisisAproximado({ vendidos: 100, vendidosExacto: false, esFull: true, precio: 79_900, moneda: "COP", dateCreated: null, itemId: "MCO64541261" });
    expect(html).not.toBe("");
    expect(html).toContain("220"); // 100 × 2.2 (Full), redondeado
  });
});
