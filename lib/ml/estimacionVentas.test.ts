import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ETIQUETA_ESTIMADO, facturacionEst, ventasMesEst } from "./estimacionVentas";

const AHORA = new Date("2026-10-31T00:00:00.000Z");

describe("ventasMesEst — estimación estilo Selltrix (issue #201, apoya #197)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(AHORA);
  });
  afterEach(() => vi.useRealTimers());

  it("sin multiplicador: vendidos × 30 ÷ días transcurridos", () => {
    // Creada hace 20 días, 100 vendidos acumulados → 100*30/20 = 150.
    const creado = new Date("2026-10-11T00:00:00.000Z");
    expect(ventasMesEst(100, creado)).toBe(150);
  });

  it("Full: aplica ×2.2 antes de proyectar al mes", () => {
    const creado = new Date("2026-10-11T00:00:00.000Z"); // 20 días
    expect(ventasMesEst(100, creado, { esFull: true })).toBe((100 * 2.2 * 30) / 20);
  });

  it("+N: aplica ×1.55 antes de proyectar al mes", () => {
    const creado = new Date("2026-10-11T00:00:00.000Z"); // 20 días
    expect(ventasMesEst(100, creado, { etiquetaMasN: true })).toBe((100 * 1.55 * 30) / 20);
  });

  it("Full y +N a la vez: Full gana, nunca se combinan los dos multiplicadores", () => {
    const creado = new Date("2026-10-11T00:00:00.000Z");
    expect(ventasMesEst(100, creado, { esFull: true, etiquetaMasN: true })).toBe(ventasMesEst(100, creado, { esFull: true }));
  });

  it("días transcurridos nunca baja de 1 (publicación creada hoy mismo)", () => {
    expect(ventasMesEst(10, AHORA)).toBe(10 * 30); // 10*30/max(1,0)
  });

  it("acepta la fecha de creación como string ISO, igual que un Date", () => {
    expect(ventasMesEst(100, "2026-10-11T00:00:00.000Z")).toBe(150);
  });

  it("soldQuantity 0 es un dato real (cero ventas confirmadas) — da 0, nunca null", () => {
    const creado = new Date("2026-10-11T00:00:00.000Z");
    expect(ventasMesEst(0, creado)).toBe(0);
  });

  it("null si falta soldQuantity, dateCreated, o la fecha es inválida — nunca 0 fabricado", () => {
    const creado = new Date("2026-10-11T00:00:00.000Z");
    expect(ventasMesEst(null, creado)).toBeNull();
    expect(ventasMesEst(100, null)).toBeNull();
    expect(ventasMesEst(100, "esto no es una fecha")).toBeNull();
    expect(ventasMesEst(-1, creado)).toBeNull(); // soldQuantity negativo: dato imposible, nunca inventado
  });
});

describe("facturacionEst (issue #201)", () => {
  it("precio real × la estimación de ventas del mes", () => {
    expect(facturacionEst(50000, 150)).toBe(50000 * 150);
  });

  it("null si falta cualquiera de los dos — nunca 0 fabricado", () => {
    expect(facturacionEst(null, 150)).toBeNull();
    expect(facturacionEst(50000, null)).toBeNull();
    expect(facturacionEst(-1, 150)).toBeNull(); // precio negativo: dato imposible
  });
});

describe("ETIQUETA_ESTIMADO (issue #201)", () => {
  it("existe como texto fijo para que toda pantalla marque igual una cifra estimada", () => {
    expect(ETIQUETA_ESTIMADO).toBe("Estimado");
  });
});
