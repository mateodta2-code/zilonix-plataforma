import { describe, expect, it } from "vitest";
import {
  calcularResumenImportado,
  fusionarProductosImportados,
  linkHttpSeguro,
  reemplazarProductosImportados,
  type ProductoImportado,
} from "./importacionListadoCliente";

function producto(parciales: Partial<ProductoImportado> & { plataforma: string; titulo: string }): ProductoImportado {
  return { precio: 10_000, vendidos: null, link: null, ...parciales };
}

describe("linkHttpSeguro — issue #213", () => {
  it("acepta http(s) real", () => {
    expect(linkHttpSeguro("https://www.amazon.com/dp/B000X")).toBe("https://www.amazon.com/dp/B000X");
  });

  it("rechaza javascript:/data: disfrazado", () => {
    expect(linkHttpSeguro("javascript:alert(1)")).toBeNull();
    expect(linkHttpSeguro("data:text/html,<script>")).toBeNull();
  });

  it("null/texto vacío/no-URL -> null, nunca lanza", () => {
    expect(linkHttpSeguro(null)).toBeNull();
    expect(linkHttpSeguro("")).toBeNull();
    expect(linkHttpSeguro("no es una url")).toBeNull();
  });
});

describe("fusionarProductosImportados — issue #213", () => {
  it("agrega los nuevos sin duplicar por link", () => {
    const actuales = [producto({ plataforma: "Amazon", titulo: "Reloj A", link: "https://amazon.com/a" })];
    const nuevos = [
      producto({ plataforma: "Amazon", titulo: "Reloj A", link: "https://amazon.com/a" }), // mismo link -> no duplica
      producto({ plataforma: "Amazon", titulo: "Reloj B", link: "https://amazon.com/b" }),
    ];
    const resultado = fusionarProductosImportados(actuales, nuevos);
    expect(resultado).toHaveLength(2);
    expect(resultado.map((p) => p.titulo)).toEqual(["Reloj A", "Reloj B"]);
  });

  it("sin link, dedup por plataforma+título", () => {
    const actuales = [producto({ plataforma: "Temu", titulo: "Funda X" })];
    const nuevos = [producto({ plataforma: "Temu", titulo: "Funda X" }), producto({ plataforma: "Shein", titulo: "Funda X" })];
    const resultado = fusionarProductosImportados(actuales, nuevos);
    // Mismo título pero OTRA plataforma no es el mismo producto -> entra.
    expect(resultado).toHaveLength(2);
  });

  it("fusionar con [] no cambia nada", () => {
    const actuales = [producto({ plataforma: "Amazon", titulo: "Reloj A" })];
    expect(fusionarProductosImportados(actuales, [])).toEqual(actuales);
  });
});

describe("reemplazarProductosImportados — issue #213", () => {
  it("descarta la sesión anterior por completo", () => {
    const anteriores = [producto({ plataforma: "Amazon", titulo: "Viejo" })];
    const nuevos = [producto({ plataforma: "Temu", titulo: "Nuevo" })];
    expect(reemplazarProductosImportados(nuevos)).toEqual(nuevos);
    expect(reemplazarProductosImportados(nuevos)).not.toBe(nuevos); // copia nueva, nunca la misma referencia
    void anteriores;
  });
});

describe("calcularResumenImportado — issue #213", () => {
  it("null (nunca 0) cuando ningún producto trae vendidos", () => {
    const resumen = calcularResumenImportado([producto({ plataforma: "Amazon", titulo: "A" }), producto({ plataforma: "Amazon", titulo: "B" })]);
    expect(resumen.sumaVendidos).toBeNull();
    expect(resumen.total).toBe(2);
  });

  it("precio mínimo/promedio/máximo y suma de vendidos solo sobre los que sí traen dato", () => {
    const resumen = calcularResumenImportado([
      producto({ plataforma: "Amazon", titulo: "A", precio: 10_000, vendidos: 5 }),
      producto({ plataforma: "Amazon", titulo: "B", precio: 30_000, vendidos: 15 }),
      producto({ plataforma: "Amazon", titulo: "C", precio: 20_000, vendidos: null }),
    ]);
    expect(resumen.precioMinimo).toBe(10_000);
    expect(resumen.precioMaximo).toBe(30_000);
    expect(resumen.precioPromedio).toBe(20_000);
    expect(resumen.sumaVendidos).toBe(20);
  });
});
