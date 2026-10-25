import { describe, expect, it } from "vitest";
import { estimarVentasMes, ETIQUETA_ESTIMACION_SELLTRIX, factorAjusteVentas } from "./estimacionVentas";

describe("factorAjusteVentas — issue #197, estilo Selltrix", () => {
  it("Full -> ×2.2, gana sobre el ajuste de etiqueta aunque también sea redondeado", () => {
    expect(factorAjusteVentas(true, false)).toBe(2.2);
    expect(factorAjusteVentas(true, true)).toBe(2.2);
  });

  it("no Full + etiqueta redondeada (no exacto) -> ×1.55", () => {
    expect(factorAjusteVentas(false, false)).toBe(1.55);
  });

  it("no Full + vendidos exacto -> ×1 (sin ajuste)", () => {
    expect(factorAjusteVentas(false, true)).toBe(1);
  });
});

describe("estimarVentasMes — issue #197", () => {
  const ahora = new Date("2026-10-24T00:00:00.000Z").getTime();

  it("vendidos exacto, no Full: vendidos × 30 ÷ días, sin ajuste", () => {
    const creado = new Date(ahora - 30 * 86_400_000).toISOString(); // 30 días antes
    const r = estimarVentasMes({ vendidos: 60, esFull: false, vendidosEsExacto: true, fechaCreacion: creado, ahoraMs: ahora });
    expect(r?.ventasMes).toBe(60); // 60*1*30/30
    expect(r?.etiqueta).toBe(ETIQUETA_ESTIMACION_SELLTRIX);
  });

  // Caso real que motivó el issue: una publicación con pocos vendidos
  // "crudos" ya no da ventas en cero/casi cero una vez ajustada.
  it("Full: el ajuste ×2.2 evita una tasa mensual subestimada", () => {
    const creado = new Date(ahora - 30 * 86_400_000).toISOString();
    const r = estimarVentasMes({ vendidos: 10, esFull: true, vendidosEsExacto: true, fechaCreacion: creado, ahoraMs: ahora });
    expect(r?.ventasMes).toBe(22); // 10*2.2*30/30
  });

  it("etiqueta redondeada (+N, no exacto): ajuste ×1.55", () => {
    const creado = new Date(ahora - 30 * 86_400_000).toISOString();
    const r = estimarVentasMes({ vendidos: 10, esFull: false, vendidosEsExacto: false, fechaCreacion: creado, ahoraMs: ahora });
    expect(r?.ventasMes).toBe(15.5); // 10*1.55*30/30
  });

  it("facturación = ventasMes × precio, redondeada; null sin precio", () => {
    const creado = new Date(ahora - 30 * 86_400_000).toISOString();
    const r = estimarVentasMes({ vendidos: 60, esFull: false, vendidosEsExacto: true, fechaCreacion: creado, precio: 50_000, ahoraMs: ahora });
    expect(r?.facturacionMes).toBe(3_000_000); // 60 * 50.000

    const sinPrecio = estimarVentasMes({ vendidos: 60, esFull: false, vendidosEsExacto: true, fechaCreacion: creado, ahoraMs: ahora });
    expect(sinPrecio?.facturacionMes).toBeNull();
  });

  it("publicación de hoy mismo: mínimo 1 día, nunca divide por 0", () => {
    const r = estimarVentasMes({ vendidos: 5, esFull: false, vendidosEsExacto: true, fechaCreacion: new Date(ahora).toISOString(), ahoraMs: ahora });
    expect(r?.ventasMes).toBe(150); // 5*30/1
  });

  it("sin vendidos válido, sin fecha, o fecha inválida -> null, nunca una cifra inventada", () => {
    expect(estimarVentasMes({ vendidos: NaN, esFull: false, vendidosEsExacto: true, fechaCreacion: new Date().toISOString() })).toBeNull();
    expect(estimarVentasMes({ vendidos: -1, esFull: false, vendidosEsExacto: true, fechaCreacion: new Date().toISOString() })).toBeNull();
    expect(estimarVentasMes({ vendidos: 10, esFull: false, vendidosEsExacto: true, fechaCreacion: "esto no es una fecha" })).toBeNull();
  });

  it("0 vendidos reales: 0 ventas/mes (nunca se infla un 0 real a algo distinto)", () => {
    const creado = new Date(ahora - 30 * 86_400_000).toISOString();
    const r = estimarVentasMes({ vendidos: 0, esFull: true, vendidosEsExacto: true, fechaCreacion: creado, ahoraMs: ahora });
    expect(r?.ventasMes).toBe(0);
  });
});
