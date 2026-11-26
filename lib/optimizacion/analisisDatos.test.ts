import { describe, expect, it, vi } from "vitest";

// Solo se prueba la parte pura: sin base ni Mercado Libre.
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));
vi.mock("@/lib/ml/cliente", () => ({ visitasCuentaMl: vi.fn() }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn() }));

import { leerPeriodoLista } from "./periodoLista";
import { agrupar, armarDatos, recortarPeriodo, sumarVisitas, topCambios, ultimosDiasParaVisitas, type LineaAnalisis, type PeriodoAnalisis } from "./analisisDatos";

const AHORA = new Date("2026-11-25T17:00:00Z");
const p: PeriodoAnalisis = { desde: "2026-11-11", hasta: "2026-11-20", dias: 10, anteriorDesde: "2026-11-01", anteriorHasta: "2026-11-10", rotulo: "x", recortado: false };

const linea = (o: Partial<LineaAnalisis>): LineaAnalisis => ({
  pedidoId: "o1", dia: "2026-11-12", estado: "paid", cancelada: false, itemId: "MCO1", cantidad: 1, precioUnitario: "100.00", titulo: "T", foto: null, ...o,
});

describe("recortarPeriodo", () => {
  it("deja igual un período de hasta 75 días", () => {
    const r = recortarPeriodo(leerPeriodoLista({ dias: "30" }, AHORA));
    expect(r.recortado).toBe(false);
    expect(r.dias).toBe(30);
  });
  it("recorta a 75 días un período de 90 y avisa", () => {
    const r = recortarPeriodo(leerPeriodoLista({ dias: "90" }, AHORA));
    expect(r.recortado).toBe(true);
    expect(r.dias).toBe(75);
    expect(r.hasta).toBe("2026-11-25");
    expect(r.desde).toBe("2026-09-12");
    expect(r.anteriorHasta).toBe("2026-09-11");
  });
});

describe("agrupar", () => {
  it("cuenta órdenes distintas, cantidad × precio, y excluye canceladas avisando", () => {
    const g = agrupar(
      [
        linea({ pedidoId: "a", cantidad: 2, precioUnitario: "50.00" }),
        linea({ pedidoId: "a", itemId: "MCO2", precioUnitario: "10.00" }),
        linea({ pedidoId: "b", dia: "2026-11-03", precioUnitario: "30.00" }),
        linea({ pedidoId: "c", cancelada: true, precioUnitario: "999.00" }),
        linea({ pedidoId: "c", itemId: "MCO2", cancelada: true }),
        linea({ pedidoId: "d", estado: "cancelled" }),
        linea({ pedidoId: "e", dia: "2026-10-01" }),
      ],
      p
    );
    expect(g.cuenta.actual).toEqual({ ventas: 1, ingresos: "110.00" });
    expect(g.cuenta.anterior).toEqual({ ventas: 1, ingresos: "30.00" });
    expect(g.canceladas).toBe(2);
    const m1 = g.publicaciones.find((x) => x.itemId === "MCO1")!;
    expect(m1.actual).toEqual({ ventas: 1, ingresos: "100.00" });
    expect(m1.anterior).toEqual({ ventas: 1, ingresos: "30.00" });
    expect(m1.cambio).toBe("70.00");
  });
});

describe("topCambios", () => {
  it("separa caídas y crecimientos y ordena por magnitud", () => {
    const mk = (itemId: string, cambio: string) => ({ itemId, titulo: itemId, foto: null, anterior: { ventas: 0, ingresos: "0.00" }, actual: { ventas: 0, ingresos: "0.00" }, cambio });
    const t = topCambios([mk("A", "-5.00"), mk("B", "-50.00"), mk("C", "20.00"), mk("D", "0.00"), mk("E", "200.00")], 10);
    expect(t.caidas.map((x) => x.itemId)).toEqual(["B", "A"]);
    expect(t.crecimientos.map((x) => x.itemId)).toEqual(["E", "C"]);
    expect(topCambios([mk("A", "-1.00"), mk("B", "-2.00")], 1).caidas.map((x) => x.itemId)).toEqual(["B"]);
  });
});

describe("visitas y atribución de la cuenta", () => {
  it("sumarVisitas suma solo el rango", () => {
    expect(sumarVisitas(new Map([["2026-11-01", 5], ["2026-11-02", 7], ["2026-11-03", 9]]), "2026-11-02", "2026-11-03")).toBe(16);
  });
  it("ultimosDiasParaVisitas es null si pasa de 150", () => {
    expect(ultimosDiasParaVisitas(p, "2026-11-25", 150)).toBe(25);
    expect(ultimosDiasParaVisitas(p, "2027-06-01", 150)).toBeNull();
  });
  it("sin visitas de Mercado Libre no hay atribución; con poca muestra tampoco", () => {
    const g = agrupar([linea({ pedidoId: "a" }), linea({ pedidoId: "b", dia: "2026-11-03" })], p);
    expect(armarDatos(p, g, { anterior: null, actual: 10 }).atribucion).toBeNull();
    const d = armarDatos(p, g, { anterior: 10, actual: 10 });
    expect(d.muestraSuficiente).toBe(false);
    expect(d.atribucion).toBeNull();
  });
  it("con muestra suficiente reparte y los aportes suman el cambio", () => {
    const g = agrupar([linea({ pedidoId: "a" }), linea({ pedidoId: "b", dia: "2026-11-03", precioUnitario: "300.00" })], p);
    const d = armarDatos(p, g, { anterior: 100, actual: 80 });
    expect(d.atribucion?.cambio).toBe("-200.00");
  });
});
