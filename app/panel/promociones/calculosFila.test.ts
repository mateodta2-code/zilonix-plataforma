import { describe, expect, it } from "vitest";
import { accionParaCandidato, estadoPrecioMinimo, numero, porcentajeDescuento, precioConPromo } from "./calculosFila";
import type { CandidatoClienteCliente } from "./tipos-cliente";

function candidato(overrides: Partial<CandidatoClienteCliente> = {}): CandidatoClienteCliente {
  return {
    id: "c1",
    cuentaMlId: "cuenta-1",
    nicknameCuenta: "Cuenta 1",
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto",
    thumbnail: null,
    tieneVariantes: false,
    tipoPromocion: "DEAL",
    estadoMl: "candidate",
    esCompartida: false,
    soloEnMl: false,
    precioOriginal: null,
    precioActual: null,
    precioMinimo: null,
    precioSugerido: null,
    gananciaEstimada: null,
    cumpleReglas: false,
    motivoRevisarManual: null,
    actualizadoTs: new Date().toISOString(),
    ...overrides,
  };
}

describe("numero", () => {
  it("null: null", () => expect(numero(null)).toBeNull());
  it("string numérica: el número", () => expect(numero("90000")).toBe(90000));
  it("string no numérica: null, nunca NaN", () => expect(numero("no-es-un-numero")).toBeNull());
});

describe("precioConPromo — rama feat-promociones-aprobacion", () => {
  it("con precioActual (el deal ya activo en ML): usa ese", () => {
    expect(precioConPromo(candidato({ precioActual: "85000", precioSugerido: "90000" }))).toBe(85000);
  });

  it("sin precioActual: cae al sugerido por el motor", () => {
    expect(precioConPromo(candidato({ precioActual: null, precioSugerido: "90000" }))).toBe(90000);
  });

  it("sin ninguno de los dos: null", () => {
    expect(precioConPromo(candidato())).toBeNull();
  });
});

describe("porcentajeDescuento", () => {
  it("10% real: (100000-90000)/100000", () => {
    expect(porcentajeDescuento(candidato({ precioOriginal: "100000", precioActual: "90000" }))).toBe(10);
  });

  it("sin precioOriginal: null, nunca un 0% inventado", () => {
    expect(porcentajeDescuento(candidato({ precioOriginal: null, precioActual: "90000" }))).toBeNull();
  });

  it("precioOriginal en 0: null (división por cero evitada)", () => {
    expect(porcentajeDescuento(candidato({ precioOriginal: "0", precioActual: "90000" }))).toBeNull();
  });

  it("sin precio con promo: null", () => {
    expect(porcentajeDescuento(candidato({ precioOriginal: "100000", precioActual: null, precioSugerido: null }))).toBeNull();
  });
});

describe("estadoPrecioMinimo — indicador dedicado al piso de Finanzas", () => {
  it("precio con promo por encima del mínimo: cumple", () => {
    expect(estadoPrecioMinimo(candidato({ precioMinimo: "80000", precioActual: "90000" }))).toBe("cumple");
  });

  it("precio con promo exactamente en el mínimo: cumple (nunca 'por_debajo' en el límite)", () => {
    expect(estadoPrecioMinimo(candidato({ precioMinimo: "80000", precioActual: "80000" }))).toBe("cumple");
  });

  it("precio con promo por debajo del mínimo: por_debajo", () => {
    expect(estadoPrecioMinimo(candidato({ precioMinimo: "90000", precioActual: "80000" }))).toBe("por_debajo");
  });

  it("sin precio mínimo cargado: sin_dato, nunca 'cumple' por default", () => {
    expect(estadoPrecioMinimo(candidato({ precioMinimo: null, precioActual: "80000" }))).toBe("sin_dato");
  });
});

describe("accionParaCandidato", () => {
  it("estadoMl 'candidate' (todavía no se unió): participar", () => {
    expect(accionParaCandidato(candidato({ estadoMl: "candidate" }))).toBe("participar");
  });

  it("cualquier otro estado (ya confirmada/pendiente): modificar", () => {
    expect(accionParaCandidato(candidato({ estadoMl: "started" }))).toBe("modificar");
    expect(accionParaCandidato(candidato({ estadoMl: "pending" }))).toBe("modificar");
  });
});
