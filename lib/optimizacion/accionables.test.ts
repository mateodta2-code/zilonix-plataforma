// Optimización · Rendimiento — «Qué hacer primero»: reglas, montos y orden.
import { describe, expect, it } from "vitest";
import { armarAccionables, elegirParaEnriquecer, nivelCalidadBajo, type EntradaAccionables, type FilaAccionable } from "./accionables";

const fila = (n: number, extra: Partial<FilaAccionable> = {}): FilaAccionable => ({
  itemId: `MCO${n}`, titulo: `Pub ${n}`, ingresos: 1000, porcentaje: 10, ventas: 10,
  impresiones: 2000, clics: 40, visitas: 100, categoria: "C1", ...extra,
});

// Mediana de la categoría: CTR 2 % (40/2000), CVR 10 % (10/100).
const sanas = [fila(1), fila(2), fila(3)];

const entrada = (filas: FilaAccionable[], extra: Partial<EntradaAccionables> = {}): EntradaAccionables => ({
  filas, senales: {}, contexto: {}, diasPeriodo: 10, conMontos: true,
  formatoMoneda: (v) => `$${v}`, formatoNumero: (v) => String(v), ...extra,
});

describe("armarAccionables", () => {
  it("portada: impresiones × (CTR mediano − CTR) × CVR × ticket", () => {
    // CTR 0,5 % < 2 % × 0,6. CVR propia 10 %, ticket 100.
    const r = armarAccionables(entrada([...sanas, fila(4, { clics: 10 })]));
    const a = r.find((x) => x.tipo === "portada")!;
    expect(a.itemId).toBe("MCO4");
    // 2000 × 0,015 × 0,10 × 100 = 300
    expect(a.monto).toBe("300.00");
    expect(a.explicacion).toContain("2000 impresiones");
  });

  it("contenido incluye 0 ventas y usa el precio actual como ticket", () => {
    const r = armarAccionables(entrada([...sanas, fila(4, { ventas: 0, ingresos: 0, porcentaje: 0, visitas: 200 })], { contexto: { MCO4: { precio: 50 } } }));
    const a = r.find((x) => x.tipo === "contenido")!;
    // (10 − 0)/100 × 200 × 50 = 1000
    expect(a.monto).toBe("1000.00");
    expect(a.explicacion).toContain("precio actual");
  });

  it("no avisa con poca muestra (menos de 1000 impresiones / 50 visitas)", () => {
    const r = armarAccionables(entrada([...sanas, fila(4, { impresiones: 999, clics: 0, visitas: 49, ventas: 0 })]));
    expect(r.filter((x) => x.itemId === "MCO4")).toHaveLength(0);
  });

  it("sin stock con ventas: venta diaria × días, aclarando el stock de hoy; sin ventas no avisa", () => {
    const r = armarAccionables(entrada(sanas, { contexto: { MCO1: { stock: 0 }, MCO2: { stock: 0 } }, filas: [fila(1), fila(2, { ventas: 0, ingresos: 0 }), fila(3)] }));
    const a = r.filter((x) => x.tipo === "stock");
    expect(a).toHaveLength(1);
    expect(a[0].monto).toBe("1000.00");
    expect(a[0].explicacion).toContain("stock de hoy");
  });

  it("precio: sin forma honesta de estimar, monto null con explicación", () => {
    const r = armarAccionables(entrada(sanas, { senales: { MCO1: { referenciaEstado: "with_benchmark_highest", referenciaPrecioSugerido: 80, referenciaDiferencia: 25 } } }));
    const a = r.find((x) => x.tipo === "precio")!;
    expect(a.monto).toBeNull();
    expect(a.explicacion).toContain("25 %");
    const c = armarAccionables(entrada(sanas, { senales: { MCO2: { competenciaEstado: "listed" } } }));
    expect(c.find((x) => x.tipo === "precio")?.itemId).toBe("MCO2");
    const ok = armarAccionables(entrada(sanas, { senales: { MCO2: { competenciaEstado: "winning", referenciaEstado: "no_benchmark_ok" } } }));
    expect(ok.some((x) => x.tipo === "precio")).toBe(false);
  });

  it("calidad: monto null salvo que ya califique en portada/contenido", () => {
    const sola = armarAccionables(entrada(sanas, { senales: { MCO1: { calidad: { nivel: "Básica", pendientes: ["Agrega fotos"] } } } }));
    expect(sola.find((x) => x.tipo === "calidad")?.monto).toBeNull();
    const conPortada = armarAccionables(entrada([...sanas, fila(4, { clics: 10 })], { senales: { MCO4: { calidad: { nivel: "Estándar", pendientes: ["Ficha"] } } } }));
    expect(conPortada.find((x) => x.tipo === "calidad")?.monto).toBe("300.00");
    const buena = armarAccionables(entrada(sanas, { senales: { MCO1: { calidad: { nivel: "Profesional", pendientes: [] } } } }));
    expect(buena.some((x) => x.tipo === "calidad")).toBe(false);
  });

  it("preguntas: sin monto, con conteo", () => {
    const r = armarAccionables(entrada(sanas, { contexto: { MCO1: { preguntasSinResponder: 3 } } }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ tipo: "preguntas", monto: null });
    expect(r[0].explicacion).toContain("3 preguntas");
  });

  it("ordena por monto desc y deja los sin monto al final", () => {
    const filas = [...sanas, fila(4, { clics: 10 }), fila(5, { ventas: 0, ingresos: 0, porcentaje: 0, visitas: 200 })];
    const r = armarAccionables(entrada(filas, { contexto: { MCO5: { precio: 50 }, MCO1: { preguntasSinResponder: 1, stock: 0 } }, senales: { MCO2: { competenciaEstado: "listed" } } }));
    const montos = r.map((x) => (x.monto === null ? null : Number(x.monto)));
    const primerNull = montos.indexOf(null);
    expect(primerNull).toBeGreaterThan(0);
    expect(montos.slice(0, primerNull)).toEqual([...montos.slice(0, primerNull)].sort((a, b) => b! - a!));
    expect(montos.slice(primerNull).every((m) => m === null)).toBe(true);
    expect(r.at(-1)!.tipo).toBe("preguntas");
  });

  it("sin permiso de ventas: ordena igual pero sin plata en el texto", () => {
    const filas = [...sanas, fila(4, { clics: 10, ingresos: null })].map((f) => ({ ...f, ingresos: null }));
    const r = armarAccionables(entrada(filas, { conMontos: false, contexto: { MCO1: { stock: 0 } } }));
    expect(r.length).toBeGreaterThan(0);
    for (const a of r) expect(a.explicacion).not.toContain("$");
  });
});

describe("helpers", () => {
  it("nivelCalidadBajo reconoce «Básica» con o sin tilde", () => {
    expect(nivelCalidadBajo("Básica")).toBe(true);
    expect(nivelCalidadBajo("basica")).toBe(true);
    expect(nivelCalidadBajo("Profesional")).toBe(false);
    expect(nivelCalidadBajo(null)).toBe(false);
  });

  it("elegirParaEnriquecer: máximo N, primero las que ya tienen accionable y luego las de más ingresos", () => {
    const filas = Array.from({ length: 20 }, (_, i) => ({ itemId: `MCO${i}`, porcentaje: 100 - i }));
    const base = [{ tipo: "portada" as const, itemId: "MCO15", titulo: "x", monto: "1.00", explicacion: "" }];
    const ids = elegirParaEnriquecer(filas, base, 10);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe("MCO15");
    expect(ids[1]).toBe("MCO0");
    expect(new Set(ids).size).toBe(10);
  });
});
