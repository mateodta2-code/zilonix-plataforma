import { describe, expect, it } from "vitest";
import {
  calcularResumenImportado,
  clasificarSenalVentas,
  fusionarProductosImportados,
  linkHttpSeguro,
  reemplazarProductosImportados,
  type ProductoImportado,
} from "./importacionListadoCliente";

function producto(parciales: Partial<ProductoImportado> & { plataforma: string; titulo: string }): ProductoImportado {
  return { precio: 10_000, senalVentas: { valor: null, tipo: "ausente" }, link: null, ...parciales };
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

// Issue #225 (parte B) — nunca repetir el bug real de Zilonix OS de
// tratar un acumulado histórico como si fuera una tasa mensual.
describe("clasificarSenalVentas — issue #225", () => {
  it("sin número -> ausente", () => {
    expect(clasificarSenalVentas("Amazon", null)).toEqual({ valor: null, tipo: "ausente" });
    expect(clasificarSenalVentas("Temu", NaN)).toEqual({ valor: null, tipo: "ausente" });
  });

  it("Amazon -> mensual_piso (único caso real confirmado, 'comprados el mes pasado')", () => {
    expect(clasificarSenalVentas("Amazon", 10_000)).toEqual({ valor: 10_000, tipo: "mensual_piso" });
  });

  it("cualquier otra plataforma con un número -> acumulado_sin_periodo, NUNCA mensual", () => {
    expect(clasificarSenalVentas("Temu", 500)).toEqual({ valor: 500, tipo: "acumulado_sin_periodo" });
    expect(clasificarSenalVentas("AliExpress", 500)).toEqual({ valor: 500, tipo: "acumulado_sin_periodo" });
    expect(clasificarSenalVentas("Shein", 500)).toEqual({ valor: 500, tipo: "acumulado_sin_periodo" });
    expect(clasificarSenalVentas("Alibaba", 500)).toEqual({ valor: 500, tipo: "acumulado_sin_periodo" });
    expect(clasificarSenalVentas("Mercado Libre Colombia", 500)).toEqual({ valor: 500, tipo: "acumulado_sin_periodo" });
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

describe("calcularResumenImportado — issue #213/#225", () => {
  it("null (nunca 0) cuando ningún producto trae señal de ventas", () => {
    const resumen = calcularResumenImportado([producto({ plataforma: "Amazon", titulo: "A" }), producto({ plataforma: "Amazon", titulo: "B" })]);
    expect(resumen.sumaAcumuladaSinPeriodo).toBeNull();
    expect(resumen.sumaMensualPiso).toBeNull();
    expect(resumen.total).toBe(2);
  });

  it("precio mínimo/promedio/máximo solo sobre los que sí traen dato", () => {
    const resumen = calcularResumenImportado([
      producto({ plataforma: "Temu", titulo: "A", precio: 10_000 }),
      producto({ plataforma: "Temu", titulo: "B", precio: 30_000 }),
      producto({ plataforma: "Temu", titulo: "C", precio: 20_000 }),
    ]);
    expect(resumen.precioMinimo).toBe(10_000);
    expect(resumen.precioMaximo).toBe(30_000);
    expect(resumen.precioPromedio).toBe(20_000);
  });

  it("suma acumulado_sin_periodo y mensual_piso por separado, nunca mezclados", () => {
    const resumen = calcularResumenImportado([
      producto({ plataforma: "Temu", titulo: "A", senalVentas: { valor: 5, tipo: "acumulado_sin_periodo" } }),
      producto({ plataforma: "AliExpress", titulo: "B", senalVentas: { valor: 15, tipo: "acumulado_sin_periodo" } }),
      producto({ plataforma: "Amazon", titulo: "C", senalVentas: { valor: 100, tipo: "mensual_piso" } }),
      producto({ plataforma: "Amazon", titulo: "D", senalVentas: { valor: 200, tipo: "mensual_piso" } }),
    ]);
    expect(resumen.sumaAcumuladaSinPeriodo).toBe(20); // 5 + 15, nunca con los 100/200 de Amazon mezclados
    expect(resumen.sumaMensualPiso).toBe(300); // 100 + 200, nunca con el acumulado de Temu/AliExpress mezclado
  });
});
