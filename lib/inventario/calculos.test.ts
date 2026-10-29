import { describe, expect, it } from "vitest";
import {
  aplicarDelta,
  CantidadInvalidaError,
  cantidadAPublicar,
  cruzaUmbralUltimaUnidad,
  decidirAccionPedido,
  deltaDeMovimiento,
  elegirBodegaParaReserva,
  esUuid,
  motivoDeItem,
  SALDO_CERO,
  saldoValido,
  stockDerivadoKit,
} from "./calculos";

// Issue #280 — reglas puras del inventario, sin Postgres.
describe("deltaDeMovimiento", () => {
  it("cada tipo mueve las columnas que le tocan", () => {
    expect(deltaDeMovimiento("entrada", 5)).toEqual({ disponible: 5, reservado: 0, enTransito: 0 });
    expect(deltaDeMovimiento("salida", 2)).toEqual({ disponible: -2, reservado: 0, enTransito: 0 });
    expect(deltaDeMovimiento("ajuste", -3)).toEqual({ disponible: -3, reservado: 0, enTransito: 0 });
    expect(deltaDeMovimiento("reserva", 1)).toEqual({ disponible: -1, reservado: 1, enTransito: 0 });
    expect(deltaDeMovimiento("liberacion", 1)).toEqual({ disponible: 1, reservado: -1, enTransito: 0 });
    expect(deltaDeMovimiento("confirmacion", 1)).toEqual({ disponible: 0, reservado: -1, enTransito: 0 });
    expect(deltaDeMovimiento("traslado", 4, "origen")).toEqual({ disponible: -4, reservado: 0, enTransito: 0 });
    expect(deltaDeMovimiento("traslado", 4, "destino")).toEqual({ disponible: 4, reservado: 0, enTransito: 0 });
  });

  it("solo enteros; negativo solo en ajuste; ajuste de 0 no existe", () => {
    expect(() => deltaDeMovimiento("entrada", 1.5)).toThrow(CantidadInvalidaError);
    expect(() => deltaDeMovimiento("entrada", 0)).toThrow(CantidadInvalidaError);
    expect(() => deltaDeMovimiento("salida", -1)).toThrow(CantidadInvalidaError);
    expect(() => deltaDeMovimiento("ajuste", 0)).toThrow(CantidadInvalidaError);
    expect(() => deltaDeMovimiento("entrada", Number.NaN)).toThrow(CantidadInvalidaError);
    expect(() => deltaDeMovimiento("traslado", 1)).toThrow();
  });

  it("reservar más de lo disponible deja un saldo inválido", () => {
    const saldo = aplicarDelta({ ...SALDO_CERO, disponible: 1 }, deltaDeMovimiento("reserva", 2));
    expect(saldoValido(saldo)).toBe(false);
    expect(saldoValido(aplicarDelta({ ...SALDO_CERO, disponible: 2 }, deltaDeMovimiento("reserva", 2)))).toBe(true);
  });
});

describe("stockDerivadoKit", () => {
  it("cuántos kits completos se arman con el componente más escaso", () => {
    const hay = new Map([
      ["a", 10],
      ["b", 3],
    ]);
    expect(stockDerivadoKit([{ skuId: "a", cantidad: 2 }, { skuId: "b", cantidad: 1 }], hay)).toBe(3);
    expect(stockDerivadoKit([{ skuId: "a", cantidad: 3 }], hay)).toBe(3);
    expect(stockDerivadoKit([{ skuId: "c", cantidad: 1 }], hay)).toBe(0);
  });

  it("un kit sin componentes no se puede armar", () => {
    expect(stockDerivadoKit([], new Map())).toBe(0);
  });
});

describe("cantidadAPublicar y la última unidad", () => {
  it("resta el colchón y nunca da negativo", () => {
    expect(cantidadAPublicar(10, 2)).toBe(8);
    expect(cantidadAPublicar(1, 2)).toBe(0);
    expect(cantidadAPublicar(5, 0)).toBe(5);
  });

  it("la alerta salta solo al BAJAR hasta el umbral", () => {
    expect(cruzaUmbralUltimaUnidad(2, 1, 1)).toBe(true);
    expect(cruzaUmbralUltimaUnidad(5, 0, 1)).toBe(true);
    expect(cruzaUmbralUltimaUnidad(1, 1, 1)).toBe(false); // ya estaba ahí
    expect(cruzaUmbralUltimaUnidad(0, 1, 1)).toBe(false); // subió
    expect(cruzaUmbralUltimaUnidad(3, 2, 1)).toBe(false); // no llegó
    expect(cruzaUmbralUltimaUnidad(2, 1, 0)).toBe(false); // regla apagada
  });
});

describe("elegirBodegaParaReserva (rechazo total)", () => {
  const saldos: Record<string, number> = { "p|a": 1, "p|b": 5, "s|a": 3, "s|b": 5 };
  const disponible = (b: string, s: string) => saldos[`${b}|${s}`] ?? 0;

  it("gana la primera bodega que tiene el pedido ENTERO", () => {
    expect(elegirBodegaParaReserva([{ skuId: "b", cantidad: 2 }], ["p", "s"], disponible)).toBe("p");
    expect(elegirBodegaParaReserva([{ skuId: "a", cantidad: 2 }, { skuId: "b", cantidad: 1 }], ["p", "s"], disponible)).toBe("s");
  });

  it("nunca parte el pedido: si ninguna alcanza, null", () => {
    expect(elegirBodegaParaReserva([{ skuId: "a", cantidad: 4 }], ["p", "s"], disponible)).toBeNull();
  });

  it("suma líneas repetidas del mismo SKU antes de decidir", () => {
    expect(elegirBodegaParaReserva([{ skuId: "a", cantidad: 2 }, { skuId: "a", cantidad: 2 }], ["p", "s"], disponible)).toBeNull();
  });
});

describe("decidirAccionPedido", () => {
  const base = { pagado: false, despachado: false, cancelado: false, tieneReserva: false, cerrado: false };
  it("pagado reserva una sola vez", () => {
    expect(decidirAccionPedido({ ...base, pagado: true })).toBe("reservar");
    expect(decidirAccionPedido({ ...base, pagado: true, tieneReserva: true })).toBe("nada");
  });
  it("despachado confirma; si nunca reservó, reserva y confirma", () => {
    expect(decidirAccionPedido({ ...base, pagado: true, despachado: true, tieneReserva: true })).toBe("confirmar");
    expect(decidirAccionPedido({ ...base, pagado: true, despachado: true })).toBe("reservar_y_confirmar");
  });
  it("cancelado libera solo lo reservado", () => {
    expect(decidirAccionPedido({ ...base, cancelado: true, tieneReserva: true })).toBe("liberar");
    expect(decidirAccionPedido({ ...base, cancelado: true })).toBe("nada");
  });
  it("un pedido cerrado no se vuelve a mover, y uno sin pagar no reserva", () => {
    expect(decidirAccionPedido({ ...base, cancelado: true, tieneReserva: true, cerrado: true })).toBe("nada");
    expect(decidirAccionPedido(base)).toBe("nada");
  });
});

describe("motivoDeItem y esUuid", () => {
  it("Full y variaciones no se envían en Fase 1", () => {
    expect(motivoDeItem({ shipping: { logistic_type: "fulfillment" } })).toBe("full");
    expect(motivoDeItem({ variations: [{ id: 1 }] })).toBe("con_variaciones");
    expect(motivoDeItem({ shipping: { logistic_type: "cross_docking" }, variations: [] })).toBeNull();
  });
  it("esUuid rechaza lo que no es un uuid", () => {
    expect(esUuid("8b1c7a52-3c2e-4d4a-9f3e-0a1b2c3d4e5f")).toBe(true);
    expect(esUuid("1; drop table skus")).toBe(false);
    expect(esUuid(undefined)).toBe(false);
  });
});
