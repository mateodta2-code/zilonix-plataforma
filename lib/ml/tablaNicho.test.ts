import { describe, expect, it } from "vitest";
import type { Bloque, ProductoListado } from "@/lib/ml/listadoCliente";
import { construirFilasNicho, formatearAntiguedad, ordenarFilasNicho, siteIdDeItemId, terminosDeBloques, totalesNicho } from "@/lib/ml/tablaNicho";

const AHORA = new Date("2026-11-15T00:00:00Z");
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000).toISOString();

function prod(o: Partial<ProductoListado> & { itemId: string | null }): ProductoListado {
  return {
    plataforma: "Mercado Libre",
    productId: null,
    titulo: "Producto " + o.itemId,
    precio: 10_000,
    foto: null,
    senalVentas: { valor: 100, tipo: "acumulado_sin_periodo" },
    esFull: false,
    esPrime: null,
    esEnvioGratis: null,
    calificacion: null,
    vendedor: null,
    link: "https://x.test/" + o.itemId,
    dateCreated: hace(300),
    ...o,
  };
}
const bloque = (termino: string, productos: ProductoListado[], plataforma = "Mercado Libre"): Bloque => ({ id: termino, plataforma, termino, queriesUsadas: [], creadoTs: 0, productos });

describe("formatearAntiguedad", () => {
  it("días, meses y años", () => {
    expect(formatearAntiguedad(10, "es-CO")).toBe("10 d");
    expect(formatearAntiguedad(122, "es-CO")).toBe("4 m");
    expect(formatearAntiguedad(840, "en-US")).toBe("2.3 a");
  });
  it("sin dato → —", () => {
    expect(formatearAntiguedad(null)).toBe("—");
    expect(formatearAntiguedad(NaN)).toBe("—");
    expect(formatearAntiguedad(-3)).toBe("—");
  });
});

describe("siteIdDeItemId", () => {
  it("lee el prefijo de país", () => {
    expect(siteIdDeItemId("MLM123")).toBe("MLM");
    expect(siteIdDeItemId("XXX1")).toBeNull();
    expect(siteIdDeItemId(null)).toBeNull();
  });
});

describe("construirFilasNicho", () => {
  it("dedupe por itemId entre términos y se queda con la fila con más datos", () => {
    const pobre = prod({ itemId: "MCO1", dateCreated: null, senalVentas: { valor: null, tipo: "ausente" } });
    const rica = prod({ itemId: "MCO1" });
    const filas = construirFilasNicho([bloque("a", [pobre]), bloque("b", [rica, prod({ itemId: "MCO2" })])], AHORA);
    expect(filas).toHaveLength(2);
    const f1 = filas.find((f) => f.itemId === "MCO1")!;
    expect(f1.vendidos).toBe(100);
    expect(f1.orden).toBe(0);
  });
  it("sin vendidos o sin antigüedad: null y sin estimar", () => {
    const sinVendidos = prod({ itemId: "MCO3", senalVentas: { valor: null, tipo: "ausente" } });
    const sinFecha = prod({ itemId: "XX9", dateCreated: null });
    const [a, b] = construirFilasNicho([bloque("a", [sinVendidos, sinFecha])], AHORA, null, []);
    expect(a.vendidos).toBeNull();
    expect(a.ventasMes).toBeNull();
    expect(a.factMes).toBeNull();
    expect(a.faltaVendidos).toBe(true);
    expect(b.antiguedadDias).toBeNull();
    expect(b.ventasMes).toBeNull();
  });
  it("filtra por término y descarta plataformas que no son ML", () => {
    const bs = [bloque("a", [prod({ itemId: "MCO1" })]), bloque("b", [prod({ itemId: "MCO2" })]), bloque("a", [prod({ itemId: "AZ1" })], "Amazon")];
    expect(construirFilasNicho(bs, AHORA, "a").map((f) => f.itemId)).toEqual(["MCO1"]);
    expect(construirFilasNicho(bs, AHORA)).toHaveLength(2);
    expect(terminosDeBloques(bs)).toEqual(["a", "b"]);
  });
  it("usa date_created real para la antigüedad y marca Full", () => {
    const [f] = construirFilasNicho([bloque("a", [prod({ itemId: "MCO1", esFull: true, dateCreated: hace(60) })])], AHORA);
    expect(Math.round(f.antiguedadDias!)).toBe(60);
    expect(f.origen).toBe("Full");
    expect(f.ventasMes).not.toBeNull();
  });
});

describe("ordenarFilasNicho y totales", () => {
  const filas = construirFilasNicho(
    [
      bloque("a", [
        prod({ itemId: "MCO1", senalVentas: { valor: 50, tipo: "acumulado_sin_periodo" }, precio: 5_000 }),
        prod({ itemId: "MCO2", senalVentas: { valor: 900, tipo: "acumulado_sin_periodo" }, precio: 20_000 }),
        prod({ itemId: "MCO3", senalVentas: { valor: null, tipo: "ausente" } }),
      ]),
    ],
    AHORA
  );
  it("por defecto fact./mes desc y sin dato al final", () => {
    expect(ordenarFilasNicho(filas).map((f) => f.itemId)).toEqual(["MCO2", "MCO1", "MCO3"]);
  });
  it("sin dato al final también en asc; por precio y por título", () => {
    expect(ordenarFilasNicho(filas, "factMes", "asc").map((f) => f.itemId)).toEqual(["MCO1", "MCO2", "MCO3"]);
    expect(ordenarFilasNicho(filas, "precio", "asc")[0].itemId).toBe("MCO1");
    expect(ordenarFilasNicho(filas, "titulo", "asc")[0].itemId).toBe("MCO1");
  });
  it("totales suman solo lo que existe", () => {
    const t = totalesNicho(filas);
    expect(t.siteId).toBe("MCO");
    expect(t.vendidos).toBe(950);
    expect(t.ventasMes).toBeCloseTo(filas.reduce((s, f) => s + (f.ventasMes ?? 0), 0));
    expect(t.factMes).toBeCloseTo(filas.reduce((s, f) => s + (f.factMes ?? 0), 0));
    expect(t.hayOtrosPaises).toBe(false);
  });
  it("sin ningún dato los totales son null; con países mezclados suma solo el dominante", () => {
    const vacias = construirFilasNicho([bloque("a", [prod({ itemId: "MCO9", senalVentas: { valor: null, tipo: "ausente" } })])], AHORA);
    expect(totalesNicho(vacias)).toMatchObject({ vendidos: null, ventasMes: null, factMes: null });
    const mezcla = construirFilasNicho([bloque("a", [prod({ itemId: "MCO1" }), prod({ itemId: "MCO2" }), prod({ itemId: "MLM1" })])], AHORA);
    const t = totalesNicho(mezcla);
    expect(t.siteId).toBe("MCO");
    expect(t.vendidos).toBe(200);
    expect(t.hayOtrosPaises).toBe(true);
  });
});
