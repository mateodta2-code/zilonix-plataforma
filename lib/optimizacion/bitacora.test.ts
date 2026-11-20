import { describe, expect, it } from "vitest";
import { ACCIONES_BITACORA, resultadoCambio } from "@/lib/optimizacion/bitacoraResultado";
import type { LineaVendida } from "@/lib/optimizacion/calculos";

const linea = (dia: string, valor: string, cantidad = 1): LineaVendida => ({ pedidoId: `p-${dia}`, dia, cantidad, valor, valida: true, costos: null });

const visitas = new Map<string, number>();
for (let d = 1; d <= 30; d++) visitas.set(`2026-11-${String(d).padStart(2, "0")}`, d <= 11 ? 10 : 20);

const base = {
  lineas: [linea("2026-11-08", "100.00"), linea("2026-11-13", "120.00"), linea("2026-11-15", "120.00"), linea("2026-11-17", "120.00")],
  publicidad: [],
  visitasPorDia: visitas,
  visitasDesde: "2026-11-01",
  conFinanzas: false,
};

describe("bitácora: resultado de un cambio", () => {
  it("mientras no pasan 7 días está «en medición» y dice cuántos faltan", () => {
    expect(resultadoCambio("2026-11-12", "2026-11-12", base)).toEqual({ estado: "midiendo", faltanDias: 7 });
    expect(resultadoCambio("2026-11-12", "2026-11-18", base)).toEqual({ estado: "midiendo", faltanDias: 1 });
  });

  it("al día 7 compara la semana antes con la semana desde el cambio", () => {
    const r = resultadoCambio("2026-11-12", "2026-11-19", base);
    if (r.estado !== "listo") throw new Error("esperaba listo");
    expect(r.desde).toBe("2026-11-05");
    expect(r.hasta).toBe("2026-11-18");
    expect(r.antes.pedidos).toBe(1); // 8-nov
    expect(r.despues.pedidos).toBe(3); // 13, 15 y 17
    expect(r.antes.visitas).toBe(70); // 5..11 a 10 por día
    expect(r.despues.visitas).toBe(140); // 12..18 a 20 por día
  });

  it("sin visitas de antes del cambio, las visitas quedan en null (nunca un 0 inventado)", () => {
    const r = resultadoCambio("2026-11-03", "2026-11-12", { ...base, visitasDesde: "2026-11-01" });
    if (r.estado !== "listo") throw new Error("esperaba listo");
    expect(r.antes.visitas).toBeNull();
  });

  it("solo las acciones de Optimización entran a la bitácora", () => {
    expect(Object.keys(ACCIONES_BITACORA).sort()).toEqual(["activar_publicacion", "cambiar_fotos_publicacion", "cambiar_precio_publicacion", "cambiar_titulo_publicacion", "pausar_publicacion"]);
  });
});
