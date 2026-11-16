import { describe, expect, it } from "vitest";
import type { Bloque, ProductoListado } from "@/lib/ml/listadoCliente";
import { concentracionTop3, construirFilasNicho, precioRecomendado, puntajeNicho, formatearAntiguedad, ordenarFilasNicho, siteIdDeItemId, terminosDeBloques, totalesNicho } from "@/lib/ml/tablaNicho";

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
    expect(f.esFull).toBe(true);
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

// Filas sintéticas con ventas/mes y precio controlados (misma antigüedad
// para todas → ventasMes proporcional a `v`).
function filasDe(especs: { v: number; precio: number; esFull?: boolean; vendedor?: string; oficial?: boolean; internacional?: boolean | null }[]) {
  return construirFilasNicho(
    [
      bloque(
        "t",
        especs.map((e, i) =>
          prod({
            itemId: "MCO" + (1000 + i),
            precio: e.precio,
            senalVentas: { valor: e.v, tipo: "acumulado_sin_periodo" },
            esFull: e.esFull ?? false,
            vendedor: e.vendedor ?? `v${i}`,
            tiendaOficial: e.oficial ?? false,
            internacional: e.internacional ?? null,
            dateCreated: hace(300),
          })
        )
      ),
    ],
    AHORA
  );
}

describe("origen Internacional / Local / —", () => {
  it("toma el dato de la tarjeta; sin dato queda null y Full va aparte", () => {
    const f = filasDe([{ v: 10, precio: 5, internacional: true, esFull: true }, { v: 10, precio: 5, internacional: false }, { v: 10, precio: 5 }]);
    expect(f.map((x) => x.origen)).toEqual(["Internacional", "Local", null]);
    expect(f[0].esFull).toBe(true);
  });
});

describe("puntajeNicho", () => {
  const variado = (n: number, v: number, precio: number) => Array.from({ length: n }, () => ({ v, precio }));
  it("sin datos suficientes devuelve null", () => {
    expect(puntajeNicho(filasDe(variado(4, 100, 80_000)))).toBeNull();
  });
  it("siempre entero entre 1 y 10", () => {
    for (const [n, v, p] of [[5, 1, 1], [100, 100_000, 5_000_000], [20, 500, 80_000]] as const) {
      const r = puntajeNicho(filasDe(variado(n, v, p)))!;
      expect(Number.isInteger(r.valor)).toBe(true);
      expect(r.valor).toBeGreaterThanOrEqual(1);
      expect(r.valor).toBeLessThanOrEqual(10);
    }
  });
  it("más demanda sube la parte de demanda", () => {
    const bajo = puntajeNicho(filasDe(variado(8, 5, 80_000)))!;
    const alto = puntajeNicho(filasDe(variado(8, 5_000, 80_000)))!;
    expect(alto.demanda).toBeGreaterThan(bajo.demanda);
    expect(alto.valor).toBeGreaterThanOrEqual(bajo.valor);
  });
  it("más Full y tiendas oficiales bajan la parte de competencia", () => {
    const libre = puntajeNicho(filasDe(variado(10, 200, 80_000)))!;
    const fuerte = puntajeNicho(filasDe(Array.from({ length: 10 }, (_, i) => ({ v: 200, precio: 80_000, esFull: i % 2 === 0, oficial: i % 2 === 1 }))))!;
    expect(fuerte.competencia).toBeLessThan(libre.competencia);
  });
  it("más vendedores distintos bajan la parte de competencia", () => {
    const pocos = puntajeNicho(filasDe(Array.from({ length: 12 }, () => ({ v: 200, precio: 80_000, vendedor: "mismo" }))))!;
    const muchos = puntajeNicho(filasDe(Array.from({ length: 12 }, (_, i) => ({ v: 200, precio: 80_000, vendedor: "x" + i }))))!;
    expect(muchos.competencia).toBeLessThan(pocos.competencia);
  });
  it("precio más alto suma más en la parte de precio; frase válida", () => {
    expect(puntajeNicho(filasDe(variado(6, 100, 320_000)))!.precio).toBeGreaterThan(puntajeNicho(filasDe(variado(6, 100, 20_000)))!.precio);
    const r = puntajeNicho(filasDe(variado(6, 100, 80_000)))!;
    expect(["Buena oportunidad", "Oportunidad moderada", "Competido", "Difícil"]).toContain(r.frase);
  });
});

describe("concentracionTop3", () => {
  it("porcentaje de ventas/mes de los 3 primeros y aviso sobre 60 %", () => {
    const c = concentracionTop3(filasDe([{ v: 700, precio: 1 }, { v: 100, precio: 1 }, { v: 100, precio: 1 }, { v: 50, precio: 1 }, { v: 50, precio: 1 }]))!;
    expect(c.porcentaje).toBe(90);
    expect(c.concentrado).toBe(true);
    const repartido = concentracionTop3(filasDe(Array.from({ length: 10 }, () => ({ v: 100, precio: 1 }))))!;
    expect(repartido.porcentaje).toBe(30);
    expect(repartido.concentrado).toBe(false);
  });
  it("con 3 o menos publicaciones con ventas devuelve null", () => {
    expect(concentracionTop3(filasDe([{ v: 5, precio: 1 }, { v: 5, precio: 1 }, { v: 5, precio: 1 }]))).toBeNull();
  });
});

describe("precioRecomendado", () => {
  it("elige el tramo de precio con más ventas/mes", () => {
    const espec = [
      ...Array.from({ length: 12 }, (_, i) => ({ v: 10, precio: 10 + i })),
      ...Array.from({ length: 6 }, (_, i) => ({ v: 1000, precio: 100 + i })),
      ...Array.from({ length: 12 }, (_, i) => ({ v: 10, precio: 200 + i })),
    ];
    const r = precioRecomendado(filasDe(espec))!;
    expect(r.desde).toBeGreaterThanOrEqual(90);
    expect(r.hasta).toBeLessThanOrEqual(130);
  });
  it("sin datos suficientes devuelve null", () => {
    expect(precioRecomendado(filasDe([{ v: 5, precio: 10 }]))).toBeNull();
  });
});
