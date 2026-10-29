import { afterEach, describe, expect, it, vi } from "vitest";

// HIGH 2 (review de Pablo) — este módulo toca Postgres (dbComoEmpresa,
// para releer candidato/reglas/piso FRESCOS) y Mercado Libre
// (obtenerAccessTokenVigente, participar/modificarPromocionMl) —
// ninguno existe en este sandbox. Mismo patrón de mock que
// lib/trabajos/buscarPromocionesMultiCuenta.test.ts: una "tx" mínima
// que devuelve lo programado por tabla y registra cada update.
const { filasPorTabla, updatesRegistrados } = vi.hoisted(() => ({
  filasPorTabla: new Map<unknown, unknown[]>(),
  updatesRegistrados: [] as Record<string, unknown>[],
}));

vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => ({
          where: async () => filasPorTabla.get(tabla) ?? [],
        }),
      }),
      update: () => ({
        set: (valores: Record<string, unknown>) => ({
          where: async () => {
            updatesRegistrados.push(valores);
            return [];
          },
        }),
      }),
    };
    return fn(tx);
  },
}));

const { obtenerAccessTokenVigenteMock } = vi.hoisted(() => ({
  obtenerAccessTokenVigenteMock: vi.fn(async (_empresaId: string, _cuentaId: string) => "token-falso"),
}));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: obtenerAccessTokenVigenteMock }));

const { participarPromocionMlMock, modificarPromocionMlMock } = vi.hoisted(() => ({
  participarPromocionMlMock: vi.fn(async (_itemId: string, _token: string, _body: { deal_price: number }) => ({ ok: true, status: 200, textoCrudo: "{}" })),
  modificarPromocionMlMock: vi.fn(async (_itemId: string, _token: string, _body: { deal_price: number }) => ({ ok: true, status: 200, textoCrudo: "{}" })),
}));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return { ...real, participarPromocionMl: participarPromocionMlMock, modificarPromocionMl: modificarPromocionMlMock };
});

import { costosSku, promocionesAcciones, promocionesCandidatos, promocionesReglas } from "@/db/schema";
import { ejecutarLoteDeAcciones, precioCambioDemasiado, validarCandidatoParaEscritura } from "./promocionesEjecucion";

type CandidatoFila = typeof promocionesCandidatos.$inferSelect;
type AccionFila = typeof promocionesAcciones.$inferSelect;

function candidato(overrides: Partial<CandidatoFila> = {}): CandidatoFila {
  return {
    id: "candidato-1",
    empresaId: "empresa-1",
    cuentaMlId: "cuenta-1",
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto",
    thumbnail: null,
    tieneVariantes: false,
    tipoPromocion: "DEAL",
    promotionIdMl: "promo-1",
    estadoMl: "candidate",
    esCompartida: false,
    soloEnMl: false,
    precioOriginal: "100000",
    precioActual: "100000",
    precioMinimo: "90000",
    precioSugerido: "90000",
    maxDiscountedPrice: null,
    gananciaEstimada: "40000",
    cumpleReglas: true,
    motivoRevisarManual: null,
    creadoTs: new Date(),
    actualizadoTs: new Date(),
    ...overrides,
  } as CandidatoFila;
}

function accion(overrides: Partial<AccionFila> = {}): AccionFila {
  return {
    id: "accion-1",
    empresaId: "empresa-1",
    cuentaMlId: "cuenta-1",
    itemId: "MCO1",
    tituloProducto: "Producto",
    tipoPromocion: "DEAL",
    promotionIdMl: "promo-1",
    accion: "participar",
    precioAntes: "100000",
    precioDespues: "90000",
    estado: "aceptada",
    aprobadoPor: "usuario-1",
    aprobadoTs: new Date(),
    ejecutadoPor: null,
    ejecutadoTs: null,
    modoSimulacion: false,
    resultadoMl: null,
    error: null,
    creadoTs: new Date(),
    ...overrides,
  } as AccionFila;
}

function reglasPorDefecto(overrides: Record<string, unknown> = {}) {
  return [{ descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true, ...overrides }];
}

function costoFila(overrides: Record<string, unknown> = {}) {
  return [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000", ...overrides }];
}

function limpiar() {
  filasPorTabla.clear();
  updatesRegistrados.length = 0;
  vi.clearAllMocks();
  obtenerAccessTokenVigenteMock.mockResolvedValue("token-falso");
  participarPromocionMlMock.mockResolvedValue({ ok: true, status: 200, textoCrudo: "{}" });
  modificarPromocionMlMock.mockResolvedValue({ ok: true, status: 200, textoCrudo: "{}" });
}

describe("validarCandidatoParaEscritura — HIGH 2 (review de Pablo): nunca confiar en el snapshot, todo se recalcula fresco", () => {
  afterEach(limpiar);

  it("candidato normal dentro de las reglas: ok, deal = piso fresco", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato(), "participar");
    expect(resultado).toEqual({ ok: true, deal: 90000 });
  });

  it("producto con variantes: rechazado, sin importar que el snapshot diga cumpleReglas=true", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato({ tieneVariantes: true }), "participar");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain("variantes");
  });

  it("tipo sin escritura por API (PRICE_DISCOUNT): rechazado, nunca se intenta", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato({ tipoPromocion: "PRICE_DISCOUNT" }), "participar");
    expect(resultado.ok).toBe(false);
  });

  it("el piso cambió a null desde la búsqueda (SKU sin precio mínimo AHORA): rechazado, nunca usa el precioMinimo del snapshot", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, []); // ya no hay fila de costos_sku para este SKU
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato(), "participar");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain("precio mínimo");
  });

  it("las reglas de la cuenta cambiaron (tope de descuento más chico): rechazado con las reglas FRESCAS, nunca las de cuando se buscó", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto({ descuentoMaximoPct: 5 })); // 100000->90000 es 10%, por encima del 5% nuevo
    filasPorTabla.set(costosSku, costoFila());
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato(), "participar");
    expect(resultado.ok).toBe(false);
  });

  it("la acción solicitada ya no corresponde al estado actual (se pide 'participar' pero ya está 'started'): rechazado", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato({ estadoMl: "started", precioActual: "95000" }), "participar");
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.motivo).toContain("ya no corresponde");
  });

  it("promoción compartida sin participarCompartidas en la cuenta: rechazada", async () => {
    filasPorTabla.set(promocionesReglas, reglasPorDefecto({ participarCompartidas: false }));
    filasPorTabla.set(costosSku, costoFila());
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato({ esCompartida: true }), "participar");
    expect(resultado.ok).toBe(false);
  });

  it("LOW 10 — nunca ok con un deal <= 0, incluso si el motor lo deja pasar (piso en 0 + tope de descuento al máximo permitido)", async () => {
    // Con el piso en 0 y el tope de descuento de la cuenta en el
    // máximo (100%), calcularCandidatosItem NO bloquea (100% no es
    // "mayor que" 100%) y deja pasar precioSugerido=0 — el guard final
    // explícito de validarCandidatoParaEscritura es la última red que
    // nunca deja salir un deal_price inválido hacia Mercado Libre.
    filasPorTabla.set(promocionesReglas, reglasPorDefecto({ descuentoMaximoPct: 100 }));
    filasPorTabla.set(costosSku, costoFila({ precioMinimoUnidad: "0" }));
    const resultado = await validarCandidatoParaEscritura("empresa-1", candidato({ precioOriginal: "100000" }), "participar");
    expect(resultado.ok).toBe(false);
  });
});

describe("precioCambioDemasiado — MED 6 (review de Pablo): criterio documentado de deriva de precio", () => {
  it("sin dato de comparación (null de cualquier lado): nunca bloquea por sí solo", () => {
    expect(precioCambioDemasiado(null, 90000)).toBe(false);
    expect(precioCambioDemasiado(90000, null)).toBe(false);
  });

  it("diferencia chica (menos del 2%): no se considera demasiado", () => {
    expect(precioCambioDemasiado(100000, 101000)).toBe(false);
  });

  it("diferencia grande (más del 2%): se considera demasiado", () => {
    expect(precioCambioDemasiado(100000, 110000)).toBe(true);
  });

  it("precioAntes=0: cualquier cambio a distinto de 0 es demasiado", () => {
    expect(precioCambioDemasiado(0, 100)).toBe(true);
    expect(precioCambioDemasiado(0, 0)).toBe(false);
  });
});

describe("ejecutarLoteDeAcciones — HIGH 2 / MED 6 / LOW 11 (review de Pablo)", () => {
  afterEach(limpiar);

  it("caso feliz — participar: llama a Mercado Libre con el deal recalculado fresco (nunca precioDespues del cliente) y marca 'ejecutada'", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());

    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion({ precioDespues: "999999" })]); // precioDespues del cliente nunca se usa

    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
    const [, , body] = participarPromocionMlMock.mock.calls[0]!;
    expect(body.deal_price).toBe(90000);
    expect(updatesRegistrados).toHaveLength(1);
    expect(updatesRegistrados[0]!.estado).toBe("ejecutada");
  });

  it("'salir': nunca llama a Mercado Libre, queda 'fallida' con el motivo documentado (MED 4 / LOW 11)", async () => {
    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion({ accion: "salir" })]);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(modificarPromocionMlMock).not.toHaveBeenCalled();
    expect(updatesRegistrados[0]!.estado).toBe("fallida");
    expect(String(updatesRegistrados[0]!.error)).toContain("confirmado");
  });

  it("el candidato ya no existe (se cerró o cambió desde la búsqueda): 'fallida', nunca llama a Mercado Libre", async () => {
    filasPorTabla.set(promocionesCandidatos, []); // ya no hay fila para esta cuenta+item+tipo
    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion()]);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(updatesRegistrados[0]!.estado).toBe("fallida");
  });

  it("MED 6 — el precio fresco se movió más del umbral desde que se aprobó: 'fallida', nunca llama a Mercado Libre", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato({ precioActual: "130000" })]); // 100000 -> 130000, 30% de salto
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion({ precioAntes: "100000" })]);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(updatesRegistrados[0]!.estado).toBe("fallida");
    expect(String(updatesRegistrados[0]!.error)).toContain("cambió");
  });

  it("ya no cumple las reglas frescas al momento de ejecutar: 'fallida', nunca llama a Mercado Libre", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, []); // el piso desapareció justo antes de ejecutar
    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion()]);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(updatesRegistrados[0]!.estado).toBe("fallida");
  });

  it("Mercado Libre responde error: 'fallida' con el status real, nunca se pierde el motivo", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    participarPromocionMlMock.mockResolvedValue({ ok: false, status: 400, textoCrudo: "Invalid promotion type" });
    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion()]);
    expect(updatesRegistrados[0]!.estado).toBe("fallida");
    expect(String(updatesRegistrados[0]!.error)).toContain("400");
  });

  it("punto 5 — no se pudo obtener el token de la cuenta: TODAS las filas de esa cuenta quedan 'fallida', nunca se intenta llamar a ML", async () => {
    obtenerAccessTokenVigenteMock.mockRejectedValue(new Error("Token vencido, sin refresh válido."));
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion({ id: "accion-1" }), accion({ id: "accion-2", itemId: "MCO2" })]);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(updatesRegistrados).toHaveLength(2);
    expect(updatesRegistrados.every((u) => u.estado === "fallida")).toBe(true);
  });

  it("punto 5 — una cuenta falla, la OTRA cuenta sigue y se ejecuta bien (el corte es por cuenta, nunca global)", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    obtenerAccessTokenVigenteMock.mockImplementation(async (_empresaId: string, cuentaMlId: string) => {
      if (cuentaMlId === "cuenta-rota") throw new Error("Sin token.");
      return "token-falso";
    });

    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion({ cuentaMlId: "cuenta-rota" }), accion({ id: "accion-2", cuentaMlId: "cuenta-1" })]);

    expect(updatesRegistrados).toHaveLength(2);
    expect(updatesRegistrados.some((u) => u.estado === "ejecutada")).toBe(true);
    expect(updatesRegistrados.some((u) => u.estado === "fallida")).toBe(true);
  });

  it("dentro de la MISMA cuenta, una falla corta las siguientes acciones de esa cuenta (break), nunca sigue a ciegas", async () => {
    filasPorTabla.set(promocionesCandidatos, [candidato()]);
    filasPorTabla.set(promocionesReglas, reglasPorDefecto());
    filasPorTabla.set(costosSku, costoFila());
    participarPromocionMlMock.mockResolvedValueOnce({ ok: false, status: 500, textoCrudo: "error real" });

    await ejecutarLoteDeAcciones("empresa-1", "usuario-1", [accion({ id: "accion-1" }), accion({ id: "accion-2", itemId: "MCO2" })]);

    // Se detuvo después de la primera falla — nunca se llamó una segunda vez para esta misma cuenta.
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
    expect(updatesRegistrados).toHaveLength(1);
    expect(updatesRegistrados[0]!.estado).toBe("fallida");
  });
});
