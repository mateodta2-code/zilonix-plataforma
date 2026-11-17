import { describe, expect, it } from "vitest";
import {
  calcularFilaGanancia,
  filtrarGanancia,
  leerFiltrosGanancia,
  resumenGanancia,
  skuDePublicacion,
  type EntradaFilaGanancia,
} from "@/lib/publicidad/ganancia";
import { promedioDecimales } from "@/lib/publicidad/kpis";

const META = "0.3000";

const base: EntradaFilaGanancia = {
  itemId: "MCO1",
  titulo: "Faja reductora",
  sku: " sku-a1 ",
  anunciado: true,
  precio: "100000.00",
  precioRegular: null,
  comisionMl: "15000.00",
  envioMl: "10000.00",
  compradorPagaEnvio: false,
  logisticType: "cross_docking",
  costos: { costo: "40000.00", empaque: "2000.00", envioAgencia: "3000.00" },
};

// Precio 100.000, sin envío ni empaque: la ganancia es 100.000 − costo − 15.000.
function conMargen(itemId: string, costo: string, extra: Partial<EntradaFilaGanancia> = {}) {
  return calcularFilaGanancia(
    {
      ...base,
      itemId,
      compradorPagaEnvio: true,
      costos: { costo, empaque: "0.00", envioAgencia: "0.00" },
      ...extra,
    },
    META,
  );
}

describe("fila de ganancia real por producto", () => {
  it("normaliza el SKU de la publicación como la llave de Finanzas", () => {
    expect(skuDePublicacion(" sku-a1 ")).toBe("SKU-A1");
    expect(skuDePublicacion("   ")).toBeNull();
    expect(skuDePublicacion(null)).toBeNull();
  });

  it("vendedor paga el envío: se resta el estimado y se rotula estimado", () => {
    const fila = calcularFilaGanancia(base, META);
    expect(fila.sku).toBe("SKU-A1");
    expect(fila.costoTotal).toBe("45000.00");
    expect(fila.envio).toEqual({ tipo: "estimado", monto: "10000.00" });
    expect(fila.resultado).toMatchObject({
      tipo: "ok",
      ganancia: "30000.00",
      margen: "0.3000",
    });
    expect(fila.banda).toBe("verde");
  });

  it("comprador paga el envío: $ 0 · comprador y no se resta", () => {
    const fila = calcularFilaGanancia({ ...base, compradorPagaEnvio: true }, META);
    expect(fila.envio).toEqual({ tipo: "comprador" });
    expect(fila.resultado).toMatchObject({ tipo: "ok", ganancia: "40000.00" });
  });

  it("Full: el envío a agencia vale $0 en el costo total", () => {
    const fila = calcularFilaGanancia({ ...base, logisticType: "fulfillment" }, META);
    expect(fila.full).toBe(true);
    expect(fila.costoTotal).toBe("42000.00");
    expect(fila.resultado).toMatchObject({ tipo: "ok", ganancia: "33000.00" });
    const sinEnvioAgencia = calcularFilaGanancia(
      {
        ...base,
        logisticType: "fulfillment",
        costos: { costo: "40000.00", empaque: "2000.00", envioAgencia: null },
      },
      META,
    );
    expect(sinEnvioAgencia.costoTotal).toBe("42000.00");
  });

  it("datos faltantes: sin dato, no 0", () => {
    const sinEmpaque = calcularFilaGanancia(
      {
        ...base,
        costos: { costo: "40000.00", empaque: null, envioAgencia: "3000.00" },
      },
      META,
    );
    expect(sinEmpaque.costoTotal).toBeNull();
    expect(sinEmpaque.resultado).toEqual({ tipo: "sin_datos" });
    expect(sinEmpaque.banda).toBe("sin_dato");
    const sinAgencia = calcularFilaGanancia(
      {
        ...base,
        costos: { costo: "40000.00", empaque: "2000.00", envioAgencia: null },
      },
      META,
    );
    expect(sinAgencia.resultado).toEqual({ tipo: "sin_datos" });
    const sinComision = calcularFilaGanancia({ ...base, comisionMl: null }, META);
    expect(sinComision.costoTotal).toBe("45000.00");
    expect(sinComision.resultado).toEqual({ tipo: "sin_datos" });
    const sinEnvio = calcularFilaGanancia({ ...base, envioMl: null }, META);
    expect(sinEnvio.envio).toEqual({ tipo: "sin_dato" });
    expect(sinEnvio.resultado).toEqual({ tipo: "sin_datos" });
  });

  it("Sin SKU frente a Sin costo", () => {
    const sinSku = calcularFilaGanancia({ ...base, sku: null }, META);
    expect(sinSku.sku).toBeNull();
    expect(sinSku.resultado).toEqual({ tipo: "sin_sku" });
    expect(sinSku.costoTotal).toBeNull();
    const sinCosto = calcularFilaGanancia({ ...base, costos: undefined }, META);
    expect(sinCosto.sku).toBe("SKU-A1");
    expect(sinCosto.resultado).toEqual({ tipo: "sin_costo" });
    const costoVacio = calcularFilaGanancia(
      {
        ...base,
        costos: { costo: null, empaque: "2000.00", envioAgencia: "3000.00" },
      },
      META,
    );
    expect(costoVacio.resultado).toEqual({ tipo: "sin_costo" });
  });

  it("límites de las bandas: = meta es verde, = meta/2 es ámbar", () => {
    // margen = (85.000 − costo) / 100.000, redondeado a 0,01 % (lo que
    // se ve en pantalla es lo que decide el color).
    expect(conMargen("a", "55000.00").banda).toBe("verde"); // 30 % = meta
    expect(conMargen("b", "55010.00").banda).toBe("amarillo"); // 29,99 %
    expect(conMargen("c", "70000.00").banda).toBe("amarillo"); // 15 % = meta/2
    expect(conMargen("d", "70010.00").banda).toBe("rojo"); // 14,99 %
  });

  it("muestra el precio regular solo si hay promoción", () => {
    expect(calcularFilaGanancia({ ...base, precioRegular: "120000.00" }, META).precioRegular).toBe("120000.00");
    expect(calcularFilaGanancia({ ...base, precioRegular: "100000.00" }, META).precioRegular).toBeNull();
  });
});

describe("filtros y resumen de la pestaña", () => {
  const filas = [
    conMargen("MCO-V", "40000.00", {
      titulo: "Camión de juguete",
      sku: "JUG-1",
    }),
    conMargen("MCO-A", "65000.00", {
      titulo: "Faja",
      sku: "FAJ-1",
      anunciado: false,
    }),
    conMargen("MCO-R", "80000.00", { titulo: "Bolso", sku: "BOL-1" }),
    calcularFilaGanancia(
      {
        ...base,
        itemId: "MCO-S",
        titulo: "Sin SKU",
        sku: null,
        anunciado: false,
      },
      META,
    ),
  ];

  it("lee los filtros de la URL con lista blanca", () => {
    expect(leerFiltrosGanancia({ q: "  faja ", banda: "rojo", anunciado: "no" })).toEqual({
      texto: "faja",
      banda: "rojo",
      anunciado: "no",
    });
    expect(leerFiltrosGanancia({ banda: "drop table", anunciado: "x" })).toEqual({ texto: "", banda: "todas", anunciado: "todos" });
  });

  it("cuenta por banda antes de filtrar por banda", () => {
    const todo = filtrarGanancia(filas, {
      texto: "",
      banda: "todas",
      anunciado: "todos",
    });
    expect(todo.conteos).toEqual({
      todas: 4,
      verde: 1,
      amarillo: 1,
      rojo: 1,
      sin_dato: 1,
    });
    // Margen más bajo primero; sin dato al final.
    expect(todo.filas.map((f) => f.itemId)).toEqual(["MCO-R", "MCO-A", "MCO-V", "MCO-S"]);
    const rojos = filtrarGanancia(filas, {
      texto: "",
      banda: "rojo",
      anunciado: "todos",
    });
    expect(rojos.filas.map((f) => f.itemId)).toEqual(["MCO-R"]);
    expect(rojos.conteos.todas).toBe(4);
  });

  it("busca por título o SKU, sin importar tildes ni mayúsculas", () => {
    expect(
      filtrarGanancia(filas, {
        texto: "camion",
        banda: "todas",
        anunciado: "todos",
      }).filas.map((f) => f.itemId),
    ).toEqual(["MCO-V"]);
    expect(
      filtrarGanancia(filas, {
        texto: "faj-1",
        banda: "todas",
        anunciado: "todos",
      }).filas.map((f) => f.itemId),
    ).toEqual(["MCO-A"]);
  });

  it("filtra por anunciado sí / no", () => {
    expect(filtrarGanancia(filas, { texto: "", banda: "todas", anunciado: "no" }).conteos).toMatchObject({
      todas: 2,
      amarillo: 1,
      sin_dato: 1,
    });
    expect(filtrarGanancia(filas, { texto: "", banda: "todas", anunciado: "si" }).filas).toHaveLength(2);
  });

  it("promedios solo de las filas que calculan", () => {
    // Ganancias 45.000, 20.000 y 5.000; márgenes 45 %, 20 % y 5 %.
    expect(resumenGanancia(filas)).toEqual({
      productos: 4,
      conCalculo: 3,
      gananciaPromedio: "23333.33",
      margenPromedio: "0.2333",
    });
    expect(resumenGanancia([])).toEqual({
      productos: 0,
      conCalculo: 0,
      gananciaPromedio: null,
      margenPromedio: null,
    });
  });

  it("promedio de decimales con negativos", () => {
    expect(promedioDecimales(["-0.2000", "0.1000"], 4)).toBe("-0.0500");
    expect(promedioDecimales(["10.00", "10.01"], 2)).toBe("10.01");
  });
});
