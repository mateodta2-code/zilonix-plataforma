import { describe, expect, it, vi } from "vitest";
import {
  armarFilaHistorial,
  claseCambioStock,
  claveFilaInventario,
  DatosModificarInvalidosError,
  fechaHoraBogota,
  parsearMovimientoModificar,
  textoDetalleMovimiento,
} from "./vista-inventario";

// Sin base: el módulo real exige DATABASE_URL_APP al importarse.
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));

// Issue #280 — reglas puras de la vista de inventario (sin base).

const SKU = "11111111-1111-4111-8111-111111111111";
const BODEGA = "22222222-2222-4222-8222-222222222222";
const OPERACION = "33333333-3333-4333-8333-333333333333";

describe("fechaHoraBogota", () => {
  it("pasa a hora de Bogotá, sin segundos y con espacio", () => {
    expect(fechaHoraBogota(new Date("2026-11-27T19:05:42Z"))).toBe("2026-11-27 14:05");
  });
  it("cruza la medianoche hacia el día anterior", () => {
    expect(fechaHoraBogota(new Date("2026-11-28T03:30:00Z"))).toBe("2026-11-27 22:30");
  });
});

describe("claseCambioStock", () => {
  it.each([
    [0, 5, "sube"],
    [3, 8, "sube"],
    [5, 3, "baja"],
    [4, 4, "sin_cambio"],
  ] as const)("%i → %i es %s", (antes, despues, esperado) => {
    expect(claseCambioStock(antes, despues)).toBe(esperado);
  });
});

describe("textoDetalleMovimiento", () => {
  it("usa la nota si existe", () => {
    expect(textoDetalleMovimiento({ tipo: "entrada", deltaDisponible: 10, nota: "Compra a proveedor" })).toBe("Compra a proveedor");
  });
  it("entrada sin nota", () => {
    expect(textoDetalleMovimiento({ tipo: "entrada", deltaDisponible: 10, nota: null })).toBe("Ingreso 10 unidades");
    expect(textoDetalleMovimiento({ tipo: "entrada", deltaDisponible: 1, nota: "  " })).toBe("Ingreso 1 unidad");
  });
  it("salida sin nota, en positivo", () => {
    expect(textoDetalleMovimiento({ tipo: "salida", deltaDisponible: -3, nota: null })).toBe("Salida 3 unidades");
  });
  it("ajuste con signo", () => {
    expect(textoDetalleMovimiento({ tipo: "ajuste", deltaDisponible: 2, nota: null })).toBe("Ajuste +2 unidades");
    expect(textoDetalleMovimiento({ tipo: "ajuste", deltaDisponible: -1, nota: null })).toBe("Ajuste -1 unidad");
  });
  it("reserva y traslado", () => {
    expect(textoDetalleMovimiento({ tipo: "reserva", deltaDisponible: -1, deltaReservado: 1, nota: null })).toBe("Reserva 1 unidad");
    expect(textoDetalleMovimiento({ tipo: "traslado", deltaDisponible: -4, nota: null })).toBe("Traslado");
  });
});

describe("armarFilaHistorial", () => {
  const base = { id: "x", ts: new Date("2026-11-27T19:05:00Z"), deltaReservado: 0, actorNombre: "Franky", nota: null };
  it("una entrada de 5 sobre 3 muestra 3 → 8 y sube", () => {
    const fila = armarFilaHistorial({ ...base, tipo: "entrada", deltaDisponible: 5, saldoDisponible: 8, actorTipo: "persona" });
    expect(fila).toMatchObject({ antes: 3, despues: 8, cambio: "sube", usuario: "Franky", fecha: "2026-11-27 14:05", detalle: "Ingreso 5 unidades" });
  });
  it("sistema y persona sin nombre", () => {
    expect(armarFilaHistorial({ ...base, tipo: "salida", deltaDisponible: -2, saldoDisponible: 1, actorTipo: "sistema" }).usuario).toBe("Sistema");
    expect(
      armarFilaHistorial({ ...base, actorNombre: null, tipo: "salida", deltaDisponible: -2, saldoDisponible: 1, actorTipo: "persona" }).usuario
    ).toBe("Persona");
  });
  it("confirmación no cambia el disponible", () => {
    const fila = armarFilaHistorial({ ...base, tipo: "confirmacion", deltaDisponible: 0, deltaReservado: -1, saldoDisponible: 4, actorTipo: "sistema" });
    expect(fila).toMatchObject({ antes: 4, despues: 4, cambio: "sin_cambio" });
  });
});

describe("claveFilaInventario", () => {
  it("usa «sin» cuando no hay bodega", () => {
    expect(claveFilaInventario({ skuId: SKU, bodegaId: null })).toBe(`${SKU}-sin`);
    expect(claveFilaInventario({ skuId: SKU, bodegaId: BODEGA })).toBe(`${SKU}-${BODEGA}`);
  });
});

describe("parsearMovimientoModificar", () => {
  const valido = { tipo: "entrada", skuId: SKU, bodegaId: BODEGA, cantidad: "10", nota: " Conteo ", operacionId: OPERACION };

  it("acepta un ingreso y una salida válidos", () => {
    expect(parsearMovimientoModificar(valido)).toEqual({ ...valido, cantidad: 10, nota: "Conteo" });
    expect(parsearMovimientoModificar({ ...valido, tipo: "salida" }).tipo).toBe("salida");
  });

  it.each([
    ["tipo ajuste", { tipo: "ajuste" }],
    ["tipo vacío", { tipo: "" }],
    ["cantidad 0", { cantidad: "0" }],
    ["cantidad decimal", { cantidad: "1.5" }],
    ["cantidad negativa", { cantidad: "-3" }],
    ["cantidad vacía", { cantidad: "" }],
    ["nota vacía", { nota: "   " }],
    ["nota muy larga", { nota: "a".repeat(201) }],
    ["skuId malo", { skuId: "1 OR 1=1" }],
    ["bodegaId malo", { bodegaId: "abc" }],
    ["operacionId malo", { operacionId: "x" }],
  ])("rechaza %s", (_, cambio) => {
    expect(() => parsearMovimientoModificar({ ...valido, ...cambio })).toThrow(DatosModificarInvalidosError);
  });
});
