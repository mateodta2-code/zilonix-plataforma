import { describe, expect, it } from "vitest";
import { ACCIONES_BITACORA, leerFechaNota, leerResultadoRevision, limpiarTextoBitacora, listoParaRevisar, resultadoCambio, esNotaAccionable, PREFIJO_ACCIONABLE, DIAS_MEDICION_ACCIONABLE, diasMedicionDe, diasAvisoDe } from "@/lib/optimizacion/bitacoraResultado";
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

describe("bitácora: revisión y notas", () => {
  it("resultado de la revisión con lista blanca; textos limpios con tope", () => {
    expect(leerResultadoRevision("sirvio")).toBe("sirvio");
    expect(leerResultadoRevision("genial")).toBeNull();
    expect(limpiarTextoBitacora("  <b>Subí</b>   la campaña ")).toBe("Subí la campaña");
    expect(limpiarTextoBitacora("x".repeat(900))).toHaveLength(500);
  });

  it("listo para revisar: terminó su semana y no tiene más de 14 días (días de calendario)", () => {
    expect(listoParaRevisar("2026-11-12", "2026-11-18")).toBe(false); // aún en medición
    expect(listoParaRevisar("2026-11-12", "2026-11-19")).toBe(true);
    expect(listoParaRevisar("2026-11-05", "2026-11-19")).toBe(true); // 14 días
    expect(listoParaRevisar("2026-11-04", "2026-11-19")).toBe(false); // más de 14
  });

  it("fecha de una nota: día real, no futura y de los últimos 150 días", () => {
    expect(leerFechaNota("2026-11-10", "2026-11-20")?.toISOString()).toBe("2026-11-10T17:00:00.000Z");
    expect(leerFechaNota("2026-11-21", "2026-11-20")).toBeNull();
    expect(leerFechaNota("2026-02-30", "2026-11-20")).toBeNull();
    expect(leerFechaNota("2026-01-01", "2026-11-20")).toBeNull();
    expect(leerFechaNota(42, "2026-11-20")).toBeNull();
  });
});

describe("accionable a 14 días", () => {
  const base = { lineas: [], publicidad: [], visitasPorDia: null, visitasDesde: "2026-01-01", conFinanzas: false };
  it("esNotaAccionable distingue por el prefijo", () => {
    expect(esNotaAccionable(`${PREFIJO_ACCIONABLE}subir fotos`)).toBe(true);
    expect(esNotaAccionable("Cambié el precio")).toBe(false);
    expect(esNotaAccionable(`  ${PREFIJO_ACCIONABLE}x`)).toBe(false);
    expect(esNotaAccionable(null)).toBe(false);
    expect(diasMedicionDe(`${PREFIJO_ACCIONABLE}x`)).toBe(14);
    expect(diasMedicionDe("otra nota")).toBe(7);
    expect(diasAvisoDe(`${PREFIJO_ACCIONABLE}x`)).toBe(21);
  });
  it("día 13 sigue midiendo y el día 14 terminado queda listo", () => {
    // día marcado 2026-11-01: la ventana «después» termina el 2026-11-14.
    expect(resultadoCambio("2026-11-01", "2026-11-13", base, DIAS_MEDICION_ACCIONABLE)).toEqual({ estado: "midiendo", faltanDias: 2 });
    expect(resultadoCambio("2026-11-01", "2026-11-14", base, DIAS_MEDICION_ACCIONABLE)).toEqual({ estado: "midiendo", faltanDias: 1 });
    const r = resultadoCambio("2026-11-01", "2026-11-15", base, DIAS_MEDICION_ACCIONABLE);
    expect(r.estado).toBe("listo");
    if (r.estado === "listo") expect([r.desde, r.hasta]).toEqual(["2026-10-18", "2026-11-14"]);
  });
  it("una nota normal sigue a 7 días", () => {
    expect(resultadoCambio("2026-11-01", "2026-11-08", base).estado).toBe("listo");
  });
  it("visitas incompletas si la ventana «antes» cae fuera del tope", () => {
    const r = resultadoCambio("2026-11-01", "2026-11-15", { ...base, visitasPorDia: new Map(), visitasDesde: "2026-10-25" }, 14);
    if (r.estado !== "listo") throw new Error("debía estar listo");
    expect(r.antes.visitas).toBeNull();
  });
  it("listoParaRevisar con 14 y aviso a 21", () => {
    expect(listoParaRevisar("2026-11-01", "2026-11-14", 14, 21)).toBe(false);
    expect(listoParaRevisar("2026-11-01", "2026-11-15", 14, 21)).toBe(true);
    expect(listoParaRevisar("2026-11-01", "2026-11-22", 14, 21)).toBe(true);
    expect(listoParaRevisar("2026-11-01", "2026-11-23", 14, 21)).toBe(false);
  });
});
