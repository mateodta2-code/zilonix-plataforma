import { describe, expect, it } from "vitest";
import {
  accionParaCandidato,
  descuentoDesdePrecio,
  estadoPrecioMinimo,
  formatoEnteroEsCo,
  formatoPorcentaje,
  formatoPorcentajeInput,
  fueraDeRango,
  gananciaEstimadaParaPrecio,
  numero,
  parsearNumeroEsCo,
  porcentajeDescuento,
  precioConPromo,
  precioDesdeDescuento,
  puedeEditarPrecio,
  rangoEdicion,
  sinMargen,
} from "./calculosFila";
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
    maxDiscountedPrice: null,
    gananciaEstimada: null,
    cumpleReglas: false,
    motivoRevisarManual: null,
    actualizadoTs: new Date().toISOString(),
    estadoDecision: null,
    motivoRechazo: null,
    motivoFalla: null,
    ...overrides,
  };
}

describe("numero", () => {
  it("null: null", () => expect(numero(null)).toBeNull());
  it("string numérica: el número", () => expect(numero("90000")).toBe(90000));
  it("string no numérica: null, nunca NaN", () => expect(numero("no-es-un-numero")).toBeNull());
});

describe("precioConPromo — rama feat-promociones-editar-precio (bug del chip corregido)", () => {
  it("con precioSugerido (el que el motor YA calculó respetando el piso): usa ese, nunca precioActual", () => {
    expect(precioConPromo(candidato({ precioActual: "56015", precioSugerido: "90000" }))).toBe(90000);
  });

  it("sin precioSugerido (el motor nunca llegó a calcular nada, ej. bloqueado): cae a precioActual", () => {
    expect(precioConPromo(candidato({ precioActual: "85000", precioSugerido: null }))).toBe(85000);
  });

  it("sin ninguno de los dos: null", () => {
    expect(precioConPromo(candidato())).toBeNull();
  });

  // Bug real reportado (VITALBISGLICINATO: precio hoy 65.900, mínimo
  // 65.900, promo 56.015 mostrando "CUMPLE" y "QUEDA POR DEBAJO" a la
  // vez). La causa real: precioActual es el número CRUDO que Mercado
  // Libre manda como "sugerido" para un candidato que todavía no se
  // unió — puede venir por debajo del piso. precioSugerido es el que
  // el motor YA calculó (lib/ml/promociones.ts siempre lo fija =
  // precioMinimo cuando hay que participar/modificar) — nunca puede
  // quedar por debajo del piso, por construcción. cumpleReglas se
  // calcula CONTRA precioSugerido, así que mostrar otro número es
  // exactamente la causa de la contradicción.
  it("reproduce el bug real: ML manda un precioActual por debajo del piso, pero precioSugerido (lo que de verdad se usaría) sí cumple — nunca contradice el chip", () => {
    const c = candidato({ precioOriginal: "65900", precioMinimo: "65900", precioActual: "56015", precioSugerido: "65900", cumpleReglas: true });
    expect(precioConPromo(c)).toBe(65900); // nunca 56015
    expect(estadoPrecioMinimo(c)).toBe("cumple"); // nunca "por_debajo" cuando cumpleReglas es true
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

// Rama feat-promociones-editar-precio, punto 1 — rango permitido para
// editar "Precio con promo"/"% desc".
describe("rangoEdicion", () => {
  it("con techo de ML (maxDiscountedPrice) por debajo del precio original: ese manda", () => {
    expect(rangoEdicion(candidato({ precioMinimo: "50000", maxDiscountedPrice: "80000", precioOriginal: "100000" }))).toEqual({ min: 50000, max: 80000 });
  });

  it("sin maxDiscountedPrice: el techo es el precio original (nunca un 'descuento' más caro que el precio de hoy)", () => {
    expect(rangoEdicion(candidato({ precioMinimo: "50000", maxDiscountedPrice: null, precioOriginal: "100000" }))).toEqual({ min: 50000, max: 100000 });
  });

  it("sin precio mínimo: null, nunca se puede editar sin un piso contra qué validar", () => {
    expect(rangoEdicion(candidato({ precioMinimo: null, precioOriginal: "100000" }))).toBeNull();
  });

  it("sin ningún techo disponible (ni maxDiscountedPrice ni precioOriginal): null", () => {
    expect(rangoEdicion(candidato({ precioMinimo: "50000", maxDiscountedPrice: null, precioOriginal: null }))).toBeNull();
  });

  it("el piso quedó por encima de todo techo real: null (rango degenerado, nunca inventa uno)", () => {
    expect(rangoEdicion(candidato({ precioMinimo: "90000", maxDiscountedPrice: "80000", precioOriginal: "100000" }))).toBeNull();
  });
});

describe("puedeEditarPrecio — punto 1: tipos sin escritura y variantes quedan de solo lectura", () => {
  it("fila normal con rango válido: editable", () => {
    expect(puedeEditarPrecio(candidato({ precioMinimo: "50000", precioOriginal: "100000", soloEnMl: false, tieneVariantes: false }))).toBe(true);
  });

  it("soloEnMl (tipo sin escritura por API, ej. UNHEALTHY_STOCK): nunca editable, 'precio fijo de ML'", () => {
    expect(puedeEditarPrecio(candidato({ precioMinimo: "50000", precioOriginal: "100000", soloEnMl: true }))).toBe(false);
  });

  it("con variantes: nunca editable (se revisa a mano, no hay un solo piso que calcular)", () => {
    expect(puedeEditarPrecio(candidato({ precioMinimo: "50000", precioOriginal: "100000", tieneVariantes: true }))).toBe(false);
  });

  it("sin rango válido (sin precio mínimo): nunca editable", () => {
    expect(puedeEditarPrecio(candidato({ precioMinimo: null, precioOriginal: "100000" }))).toBe(false);
  });
});

describe("precioDesdeDescuento / descuentoDesdePrecio — cálculo %↔precio, redondeado a pesos enteros", () => {
  it("20% de descuento sobre 100000: 80000", () => {
    expect(precioDesdeDescuento(100000, 20)).toBe(80000);
  });

  it("redondea a pesos enteros (nunca centavos)", () => {
    expect(precioDesdeDescuento(99999, 15)).toBe(Math.round(99999 * 0.85));
    expect(Number.isInteger(precioDesdeDescuento(99999, 15))).toBe(true);
  });

  it("descuentoDesdePrecio es el inverso real de precioDesdeDescuento", () => {
    expect(descuentoDesdePrecio(100000, 80000)).toBe(20);
  });

  it("original en 0: 0%, nunca división por cero ni NaN", () => {
    expect(descuentoDesdePrecio(0, 80000)).toBe(0);
  });
});

describe("gananciaEstimadaParaPrecio — utilidad estimada para un precio editado a mano", () => {
  it("deriva el costo implícito (precioSugerido - gananciaEstimada) y lo aplica al nuevo precio", () => {
    // precioSugerido=80000, gananciaEstimada=30000 => costo implícito=50000
    const c = candidato({ precioSugerido: "80000", gananciaEstimada: "30000" });
    expect(gananciaEstimadaParaPrecio(c, 90000)).toBe(40000); // 90000 - 50000
    expect(gananciaEstimadaParaPrecio(c, 80000)).toBe(30000); // el mismo precio sugerido, misma ganancia de siempre
  });

  it("sin precioSugerido o sin gananciaEstimada original: null, nunca inventa un costo", () => {
    expect(gananciaEstimadaParaPrecio(candidato({ precioSugerido: null, gananciaEstimada: "30000" }), 90000)).toBeNull();
    expect(gananciaEstimadaParaPrecio(candidato({ precioSugerido: "80000", gananciaEstimada: null }), 90000)).toBeNull();
  });
});

// Rama fix-promociones-edicion, punto 3 — bug real reportado por Mateo
// en staging: "27.557278635919...%" salía crudo en las filas de solo
// lectura.
describe("formatoPorcentaje / formatoPorcentajeInput — redondeo a 1 decimal, formato es-CO", () => {
  it("redondea un número largo a 1 decimal con coma decimal (bug real reportado)", () => {
    expect(formatoPorcentaje(27.557278635919)).toBe("27,6%");
    expect(formatoPorcentajeInput(27.557278635919)).toBe("27,6");
  });

  it("siempre muestra 1 decimal, incluso en un número redondo", () => {
    expect(formatoPorcentaje(10)).toBe("10,0%");
  });

  it("null: guion, nunca '0%' inventado", () => {
    expect(formatoPorcentaje(null)).toBe("—");
  });

  it("redondea hacia arriba en el límite (es-CO redondea igual que Math.round en este rango)", () => {
    expect(formatoPorcentaje(9.95)).toBe("10,0%");
  });
});

describe("formatoEnteroEsCo — precio entero con puntos de miles, sin signo $", () => {
  it("formatea con puntos de miles", () => {
    expect(formatoEnteroEsCo(169900)).toBe("169.900");
  });

  it("redondea antes de formatear", () => {
    expect(formatoEnteroEsCo(169900.4)).toBe("169.900");
  });
});

// Rama fix-promociones-edicion, punto 1 — el borrador de texto acepta
// el formato real es-CO (puntos de miles, coma decimal), nunca el
// formato con punto decimal que asumía `Number(texto)` a secas.
describe("parsearNumeroEsCo", () => {
  it("un precio con puntos de miles: el número sin los puntos", () => {
    expect(parsearNumeroEsCo("169.900")).toBe(169900);
  });

  it("un % con coma decimal: el número con punto decimal real", () => {
    expect(parsearNumeroEsCo("27,6")).toBe(27.6);
  });

  it("precio con puntos de miles Y nada más: entero exacto, nunca 169.9 (el punto NO es decimal en este formato)", () => {
    expect(parsearNumeroEsCo("49.900")).toBe(49900);
  });

  it("vacío o solo '-': null, nunca NaN ni 0 inventado", () => {
    expect(parsearNumeroEsCo("")).toBeNull();
    expect(parsearNumeroEsCo("  ")).toBeNull();
    expect(parsearNumeroEsCo("-")).toBeNull();
  });

  it("texto no numérico: null", () => {
    expect(parsearNumeroEsCo("abc")).toBeNull();
  });
});

describe("fueraDeRango — rama fix-promociones-edicion, punto 1 (ya NO se fuerza de vuelta al rango)", () => {
  it("dentro del rango: false", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "169900", precioOriginal: "199900" });
    expect(fueraDeRango(c, 160000)).toBe(false);
  });

  it("por debajo del mínimo: true", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "169900", precioOriginal: "199900" });
    expect(fueraDeRango(c, 100000)).toBe(true);
  });

  it("por encima del máximo: true", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "169900", precioOriginal: "199900" });
    expect(fueraDeRango(c, 180000)).toBe(true);
  });

  it("sin rango válido (ej. sin precio mínimo): false — nada que comparar, nunca bloquea por sí solo", () => {
    const c = candidato({ precioMinimo: null, precioOriginal: "199900" });
    expect(fueraDeRango(c, 100)).toBe(false);
  });

  it("exactamente en el límite (mín o máx): false, nunca 'fuera' en el borde", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "169900", precioOriginal: "199900" });
    expect(fueraDeRango(c, 149900)).toBe(false);
    expect(fueraDeRango(c, 169900)).toBe(false);
  });
});

// Punto 2 (rama fix-promociones-aprobadas-participando) — bug real:
// "Sí" quedaba gris sin explicación cuando el techo real (maxDiscountedPrice
// o precioOriginal) quedaba en o por debajo del piso de Finanzas —
// literalmente no hay ningún descuento posible por encima del piso.
describe("sinMargen", () => {
  it("techo exactamente igual al piso (mínimo = máximo = precio mínimo de Finanzas, el caso real reportado): true", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "149900", precioOriginal: "199900" });
    expect(sinMargen(c)).toBe(true);
  });

  it("techo por debajo del piso: true", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "140000", precioOriginal: "199900" });
    expect(sinMargen(c)).toBe(true);
  });

  it("techo real por encima del piso (hay margen real): false", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: "169900", precioOriginal: "199900" });
    expect(sinMargen(c)).toBe(false);
  });

  it("sin precio mínimo cargado: false — ese es otro caso, 'Falta precio mínimo'", () => {
    const c = candidato({ precioMinimo: null, maxDiscountedPrice: "149900", precioOriginal: "199900" });
    expect(sinMargen(c)).toBe(false);
  });

  it("sin ningún techo disponible: false, nada que comparar", () => {
    const c = candidato({ precioMinimo: "149900", maxDiscountedPrice: null, precioOriginal: null });
    expect(sinMargen(c)).toBe(false);
  });
});
