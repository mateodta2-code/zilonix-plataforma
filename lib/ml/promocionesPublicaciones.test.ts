import { afterEach, describe, expect, it, vi } from "vitest";

// Mismo patrón de mock que lib/ml/promocionesEjecucion.test.ts — ni
// Postgres ni Mercado Libre existen en este sandbox.
const { filasPorTabla, insertsRegistrados } = vi.hoisted(() => ({
  filasPorTabla: new Map<unknown, unknown[]>(),
  insertsRegistrados: [] as Record<string, unknown>[],
}));

vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => ({
          where: async () => filasPorTabla.get(tabla) ?? [],
        }),
      }),
      insert: () => ({
        values: (valores: Record<string, unknown>) => {
          insertsRegistrados.push(valores);
          const id = `accion-${insertsRegistrados.length}`;
          // Awaitable directo (lote) o con .returning() (individual).
          return { returning: async () => [{ id }], then: (ok: (v: unknown) => unknown) => Promise.resolve(undefined).then(ok) };
        },
      }),
    };
    return fn(tx);
  },
}));

const { obtenerAccessTokenVigenteMock } = vi.hoisted(() => ({
  obtenerAccessTokenVigenteMock: vi.fn(async (_empresaId: string, _cuentaId: string) => "token-falso"),
}));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: obtenerAccessTokenVigenteMock }));

const {
  leerItemParaPromocionMlMock,
  leerPromocionesItemMlMock,
  listarItemsActivosMlMock,
  participarPromocionMlMock,
  modificarPromocionMlMock,
  leerNombrePromocionMlMock,
} = vi.hoisted(() => ({
  leerNombrePromocionMlMock: vi.fn(async (): Promise<string | null> => null),
  leerItemParaPromocionMlMock: vi.fn(),
  leerPromocionesItemMlMock: vi.fn(),
  listarItemsActivosMlMock: vi.fn(),
  participarPromocionMlMock: vi.fn(async () => ({ ok: true, status: 200, textoCrudo: "{}" })),
  modificarPromocionMlMock: vi.fn(async () => ({ ok: true, status: 200, textoCrudo: "{}" })),
}));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return {
    ...real,
    leerItemParaPromocionMl: leerItemParaPromocionMlMock,
    leerPromocionesItemMl: leerPromocionesItemMlMock,
    listarItemsActivosMl: listarItemsActivosMlMock,
    participarPromocionMl: participarPromocionMlMock,
    modificarPromocionMl: modificarPromocionMlMock,
    leerNombrePromocionMl: leerNombrePromocionMlMock,
  };
});

import { costosSku, cuentasMl, promocionesReglas } from "@/db/schema";
import {
  aplicarReglaALote,
  aplicarTopeMaximo,
  codificarCursor,
  decodificarCursor,
  leerPublicacionConEstado,
  leerResumenMaestraSku,
  listarPublicacionesConEstado,
  participarEnPublicacionDirecto,
} from "./promocionesPublicaciones";

function itemBasico(overrides: Partial<Awaited<ReturnType<typeof leerItemParaPromocionMlMock>>> = {}) {
  return { title: "Producto", thumbnail: "https://x/thumb.jpg", skuCodigo: "SKU-1", tieneVariantes: false, skuVariantesDistintas: false, precio: 100000, stock: 5, ...overrides };
}

afterEach(() => {
  vi.clearAllMocks();
  filasPorTabla.clear();
  insertsRegistrados.length = 0;
});

describe("decodificarCursor/codificarCursor", () => {
  it("cursor vacío/null vuelve al principio", () => {
    expect(decodificarCursor(null)).toEqual({ cuentaIndice: 0, offset: 0 });
    expect(decodificarCursor(undefined)).toEqual({ cuentaIndice: 0, offset: 0 });
  });

  it("codifica y decodifica de vuelta sin pérdida", () => {
    const cursor = codificarCursor({ cuentaIndice: 2, offset: 40 });
    expect(decodificarCursor(cursor)).toEqual({ cuentaIndice: 2, offset: 40 });
  });

  it("un cursor corrupto/ajeno nunca tira una excepción — vuelve al principio", () => {
    expect(decodificarCursor("no-es-base64-valido-{}")).toEqual({ cuentaIndice: 0, offset: 0 });
    expect(decodificarCursor(Buffer.from(JSON.stringify({ cuentaIndice: -1, offset: 0 }), "utf8").toString("base64url"))).toEqual({ cuentaIndice: 0, offset: 0 });
  });
});

describe("leerPublicacionConEstado", () => {
  const reglas = { descuentoMaximoPct: 20, participarCompartidas: false, igualarAlPiso: true };
  const leerPiso = async () => ({ precioMinimo: 90000, costo: 50000 });

  it("sin promociones aplicables: estado sin_promocion, trae igual título/precio/stock", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [] });
    const fila = await leerPublicacionConEstado("MCO1", "cuenta-1", "Mi Tienda", "MCO", "token", reglas, leerPiso);
    expect(fila).toMatchObject({ estado: "sin_promocion", tituloProducto: "Producto", precioOriginal: 100000, stock: 5, promociones: [] });
  });

  it("con una promoción started: estado en_promocion, trae el cálculo del motor", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValueOnce({
      estado: "ok",
      promociones: [{ type: "DEAL", status: "started", id: "promo-1", price: 90000, original_price: 100000 }],
    });
    const fila = await leerPublicacionConEstado("MCO1", "cuenta-1", "Mi Tienda", "MCO", "token", reglas, leerPiso);
    expect(fila.estado).toBe("en_promocion");
    expect(fila.promociones).toHaveLength(1);
    expect(fila.promociones[0]).toMatchObject({ tipoPromocion: "DEAL", estadoMl: "started", cumpleReglas: true });
  });

  it("una promoción candidate todavía no unida: en_promocion solo cuando ya está started/pending, nunca con candidate", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000 }] });
    const fila = await leerPublicacionConEstado("MCO1", "cuenta-1", "Mi Tienda", "MCO", "token", reglas, leerPiso);
    expect(fila.estado).toBe("sin_promocion");
    expect(fila.promociones[0].accionSugerida).toBe("participar");
  });

  it("sin_permiso (403 de la app): estado error con motivo claro, nunca se confunde con sin_promocion", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "sin_permiso" });
    const fila = await leerPublicacionConEstado("MCO1", "cuenta-1", "Mi Tienda", "MCO", "token", reglas, leerPiso);
    expect(fila.estado).toBe("error");
    expect(fila.motivoError).toMatch(/permiso/i);
  });

  it("leerItemParaPromocionMl devuelve null: estado error", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(null);
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [] });
    const fila = await leerPublicacionConEstado("MCO1", "cuenta-1", "Mi Tienda", "MCO", "token", reglas, leerPiso);
    expect(fila.estado).toBe("error");
  });

  it("una excepción (ej. 429 que agotó reintentos) nunca se escapa — vuelve como fila con estado error", async () => {
    leerItemParaPromocionMlMock.mockRejectedValueOnce(new Error("boom"));
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [] });
    const fila = await leerPublicacionConEstado("MCO1", "cuenta-1", "Mi Tienda", "MCO", "token", reglas, leerPiso);
    expect(fila.estado).toBe("error");
  });
});

describe("listarPublicacionesConEstado", () => {
  function prepararCuenta() {
    filasPorTabla.set(cuentasMl, [{ id: "cuenta-1", cuentaIdExterna: "123", nickname: "Mi Tienda", siteId: "MCO" }]);
  }

  it("una sola página, menos ítems que el tamaño de página: cursorSiguiente null", async () => {
    prepararCuenta();
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: ["MCO1", "MCO2"], totalCatalogo: 2 });
    leerItemParaPromocionMlMock.mockImplementation(async () => itemBasico());
    leerPromocionesItemMlMock.mockImplementation(async () => ({ estado: "ok", promociones: [] }));

    const resultado = await listarPublicacionesConEstado("empresa-1", { cuentaId: "todas", filtro: "todas", buscar: "", cursor: null, tamanoPagina: 20 });
    expect(resultado.filas).toHaveLength(2);
    expect(resultado.conteosLote).toEqual({ todas: 2, enPromocion: 0, sinPromocion: 2, conError: 0 });
    expect(resultado.cursorSiguiente).toBeNull();
  });

  it("filtra por estado y por búsqueda de título/SKU", async () => {
    prepararCuenta();
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: ["MCO1", "MCO2"], totalCatalogo: 2 });
    leerItemParaPromocionMlMock.mockImplementation(async (itemId: string) => itemBasico({ title: itemId === "MCO1" ? "Camisa azul" : "Pantalón gris", skuCodigo: itemId }));
    leerPromocionesItemMlMock.mockImplementation(async () => ({ estado: "ok", promociones: [] }));

    const resultado = await listarPublicacionesConEstado("empresa-1", { cuentaId: "todas", filtro: "sin-promocion", buscar: "camisa", cursor: null, tamanoPagina: 20 });
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0].tituloProducto).toBe("Camisa azul");
    // El contador del lote SÍ cuenta las 2, aunque el filtro/búsqueda solo deje pasar 1.
    expect(resultado.conteosLote.todas).toBe(2);
  });

  it("devuelve cursorSiguiente cuando hay más en la misma cuenta", async () => {
    prepararCuenta();
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: Array.from({ length: 20 }, (_, i) => `MCO${i}`), totalCatalogo: 50 });
    leerItemParaPromocionMlMock.mockImplementation(async () => itemBasico());
    leerPromocionesItemMlMock.mockImplementation(async () => ({ estado: "ok", promociones: [] }));

    const resultado = await listarPublicacionesConEstado("empresa-1", { cuentaId: "todas", filtro: "todas", buscar: "", cursor: null, tamanoPagina: 10 });
    expect(resultado.filas).toHaveLength(20); // el lote entero ya se procesó, aunque tamanoPagina sea 10
    expect(resultado.cursorSiguiente).not.toBeNull();
    expect(decodificarCursor(resultado.cursorSiguiente)).toEqual({ cuentaIndice: 0, offset: 20 });
  });

  it("una cuenta sin token válido se salta, nunca frena la lista entera", async () => {
    filasPorTabla.set(cuentasMl, [
      { id: "cuenta-rota", cuentaIdExterna: "1", nickname: "Rota", siteId: "MCO" },
      { id: "cuenta-1", cuentaIdExterna: "123", nickname: "Sana", siteId: "MCO" },
    ]);
    obtenerAccessTokenVigenteMock.mockImplementationOnce(async () => {
      throw new Error("token vencido");
    });
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: ["MCO1"], totalCatalogo: 1 });
    leerItemParaPromocionMlMock.mockImplementation(async () => itemBasico());
    leerPromocionesItemMlMock.mockImplementation(async () => ({ estado: "ok", promociones: [] }));

    const resultado = await listarPublicacionesConEstado("empresa-1", { cuentaId: "todas", filtro: "todas", buscar: "", cursor: null, tamanoPagina: 20 });
    expect(resultado.filas).toHaveLength(1);
    expect(resultado.filas[0].nicknameCuenta).toBe("Sana");
  });
});

describe("participarEnPublicacionDirecto", () => {
  it("valida, escribe en Mercado Libre y deja auditoría con estado ejecutada", async () => {
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000 }] });

    const resultado = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", undefined);

    expect(resultado.ok).toBe(true);
    expect(resultado.estado).toBe("ejecutada");
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
    expect(insertsRegistrados).toHaveLength(1);
    expect(insertsRegistrados[0]).toMatchObject({ accion: "participar", estado: "ejecutada" });
    // Promo-E: la acción individual es una tanda de 1, con su lote.
    expect(insertsRegistrados[0].resultadoMl).toMatchObject({ regla: "manual", origen: "individual", limite: "piso" });
    expect((insertsRegistrados[0].resultadoMl as { lote: string }).lote).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("promoción que ya no está disponible: falla sin llamar a Mercado Libre para escribir", async () => {
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [] });

    const resultado = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", undefined);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/ya no está disponible/i);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(insertsRegistrados).toHaveLength(0);
  });

  it("sin precio mínimo cargado en Finanzas: la validación bloquea, nunca se escribe en ML", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico({ skuCodigo: "SKU-SIN-PISO" }));
    leerPromocionesItemMlMock.mockResolvedValueOnce({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000 }] });

    const resultado = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", undefined);

    expect(resultado.ok).toBe(false);
    expect(resultado.error).toMatch(/precio mínimo/i);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });
});

describe("participarEnPublicacionDirecto — Promo-F «maximo»", () => {
  const promoDeal = (sugerido: number) => ({ estado: "ok" as const, promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: sugerido }] });

  it("sin precio mínimo cargado: participa si el descuento ≤ X % y la bitácora dice maximo/tope", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico({ skuCodigo: "SKU-SIN-PISO" }));
    leerPromocionesItemMlMock.mockResolvedValueOnce(promoDeal(95000));

    const r = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", undefined, "maximo", 6);

    expect(r.ok).toBe(true);
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 95000 }));
    expect(insertsRegistrados[0].resultadoMl).toMatchObject({ regla: "maximo", origen: "individual", limite: "tope", maximoPct: 6 });
  });

  it("el servidor aplica el tope: promo que pide más del X % no se escribe", async () => {
    leerItemParaPromocionMlMock.mockResolvedValueOnce(itemBasico({ skuCodigo: "SKU-SIN-PISO" }));
    leerPromocionesItemMlMock.mockResolvedValueOnce(promoDeal(80000));

    const r = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", undefined, "maximo", 6);

    expect(r.ok).toBe(false);
    expect(r.error).toContain("supera el máximo de 6 %");
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("un precio elegido a mano que supera el tope tampoco se escribe; maximoPct inválido = rechazo", async () => {
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico({ skuCodigo: "SKU-SIN-PISO" }));
    leerPromocionesItemMlMock.mockResolvedValue(promoDeal(95000));

    const r = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", 80000, "maximo", 6);
    expect(r.ok).toBe(false);
    const r2 = await participarEnPublicacionDirecto("empresa-1", "usuario-1", "cuenta-1", "MCO1", "promo-1", "DEAL", undefined, "maximo", undefined);
    expect(r2.ok).toBe(false);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });
});

describe("leerResumenMaestraSku", () => {
  it("sin ningún SKU cargado: total 0, actualizadoTs null", async () => {
    filasPorTabla.set(costosSku, []);
    await expect(leerResumenMaestraSku("empresa-1")).resolves.toEqual({ total: 0, actualizadoTs: null });
  });

  it("con SKUs cargados: total real y la fecha MÁS reciente", async () => {
    const vieja = new Date("2026-01-01T00:00:00Z");
    const nueva = new Date("2026-05-01T00:00:00Z");
    filasPorTabla.set(costosSku, [{ actualizadoTs: vieja }, { actualizadoTs: nueva }]);
    await expect(leerResumenMaestraSku("empresa-1")).resolves.toEqual({ total: 2, actualizadoTs: nueva });
  });
});

const SELECCION_MCO1 = [{ cuentaId: "cuenta-1", itemId: "MCO1" }];

describe("aplicarTopeMaximo", () => {
  it("no toca lo que ya cumple el tope", () => {
    const c = { cumpleReglas: true, accionSugerida: "participar", tipoPromocion: "DEAL", precioOriginal: 100000, precioSugerido: 95000, maxDiscountedPrice: null } as never;
    expect(aplicarTopeMaximo(c, 6)).toBe(c);
  });
});

describe("aplicarReglaALote", () => {
  function prepararCuenta() {
    filasPorTabla.set(cuentasMl, [{ id: "cuenta-1", cuentaIdExterna: "123", nickname: "Mi Tienda", siteId: "MCO" }]);
  }

  it("regla 'todas': participa SIN piso, con el precio sugerido por ML, aunque no haya fila en costos_sku", async () => {
    prepararCuenta();
    // Sin ninguna fila en costos_sku: con piso esto se bloquearía; «todas» no lo exige.
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 60000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "todas" });

    expect(resumen.participadas).toBe(1);
    expect(resumen.fallidas).toBe(0);
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 60000 }));
  });

  it("regla 'todas': ni siquiera lee costos_sku (no hay piso que leer)", async () => {
    prepararCuenta();
    // Si se leyera, un piso de 90.000 forzaría ese precio; el sugerido de ML (60.000) tiene que ganar.
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 60000 }] });

    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "todas" });

    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 60000 }));
  });

  it("regla 'todas': si ML no sugiere precio, la fila se omite con su motivo (nunca se inventa un precio)", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "todas" });

    expect(resumen.participadas).toBe(0);
    expect(resumen.omitidas).toBe(1);
    expect(resumen.filas[0].error).toContain("no sugiere un precio");
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("regla 'todas': el gate de «compartida» sigue activo", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 60000, meli_percentage: 10 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "todas" });

    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(resumen.omitidas).toBe(1);
  });

  it("regla 'tabla-maestra': SÍ exige piso — sin fila en costos_sku no participa; con piso, manda el piso", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 60000 }] });

    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).not.toHaveBeenCalled();

    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 90000 }));
  });

  it("Promo-F · regla 'maximo': NO exige piso — sin fila en costos_sku participa si el descuento a cargo del vendedor es ≤ X %", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 95000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "maximo", maximoPct: 6 });

    expect(resumen.participadas).toBe(1);
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 95000 }));
  });

  it("Promo-F · regla 'maximo': descarta (DEAL) lo que supera el tope, con el motivo, sin llamar a Mercado Libre", async () => {
    prepararCuenta();
    // Aunque haya piso de 50.000, 'maximo' no lo usa: solo el tope.
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "50000", costo: "30000" }]);
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 90000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "maximo", maximoPct: 5 });

    expect(resumen.participadas).toBe(0);
    expect(resumen.filas[0].error).toBe("El descuento a cargo del vendedor (10.0 %) supera el máximo de 5 %.");
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    // Promo-E: la descartada por la regla queda en la bitácora, sin llamar a ML.
    expect(insertsRegistrados).toHaveLength(1);
    expect(insertsRegistrados[0]).toMatchObject({ estado: "rechazada", itemId: "MCO1", resultadoMl: { regla: "maximo", origen: "lote", maximoPct: 5, limite: "tope", llamoAMercadoLibre: false } });
    expect((insertsRegistrados[0].resultadoMl as { lote: string }).lote).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("Promo-F · regla 'maximo': PRICE_DISCOUNT que pide más del X % entra con el precio a X % (redondeado hacia arriba)", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "PRICE_DISCOUNT", status: "candidate", id: "promo-2", original_price: 100001, suggested_discounted_price: 70000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "maximo", maximoPct: 6 });

    expect(resumen.participadas).toBe(1);
    // 100001 × 0,94 = 94000,94 → 94001 (descuento 5,99 % ≤ 6 %).
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 94001 }));
  });

  it("Promo-F · regla 'maximo': PRICE_DISCOUNT con X < 5 % no participa (rango de ML) y lo dice", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "PRICE_DISCOUNT", status: "candidate", id: "promo-2", original_price: 100000, suggested_discounted_price: 70000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "maximo", maximoPct: 3 });

    expect(resumen.participadas).toBe(0);
    expect(resumen.filas[0].error).toContain("supera el máximo de 3 %");
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("Promo-A: con 2 publicaciones seleccionadas solo procesa esas 2, nunca lista el catálogo", async () => {
    prepararCuenta();
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, suggested_discounted_price: 60000 }] });

    const resumen = await aplicarReglaALote(
      "empresa-1",
      "usuario-1",
      [
        { cuentaId: "cuenta-1", itemId: "MCO1" },
        { cuentaId: "cuenta-1", itemId: "MCO2" },
      ],
      { tipo: "todas" }
    );

    expect(resumen.participadas).toBe(2);
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(2);
    expect(leerPromocionesItemMlMock).toHaveBeenCalledTimes(2);
    expect(listarItemsActivosMlMock).not.toHaveBeenCalled();
  });

  it("Promo-A: una cuenta que no es de la empresa nunca se toca — queda omitida", async () => {
    prepararCuenta();
    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", [{ cuentaId: "cuenta-ajena", itemId: "MCO9" }], { tipo: "todas" });
    expect(resumen).toMatchObject({ participadas: 0, omitidas: 1 });
    expect(leerPromocionesItemMlMock).not.toHaveBeenCalled();
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("una cuenta sin token válido se salta sin romper el lote", async () => {
    filasPorTabla.set(cuentasMl, [{ id: "cuenta-rota", cuentaIdExterna: "1", nickname: "Rota", siteId: "MCO" }]);
    obtenerAccessTokenVigenteMock.mockImplementationOnce(async () => {
      throw new Error("token vencido");
    });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", [{ cuentaId: "cuenta-rota", itemId: "MCO1" }], { tipo: "todas" });
    // No se pudo usar la cuenta: la publicación elegida queda omitida con motivo, sin llamar a ML.
    expect(resumen).toMatchObject({ participadas: 0, omitidas: 1 });
    expect(leerItemParaPromocionMlMock).not.toHaveBeenCalled();
    expect(listarItemsActivosMlMock).not.toHaveBeenCalled();
  });
});

describe("aplicarReglaALote — «Reglas adicionales» (PR 2): solo con tabla-maestra, el piso siempre gana", () => {
  const FILA_REGLAS = (json: unknown) => ({ cuentaMlId: "cuenta-1", descuentoMaximoPct: 90, participarCompartidas: false, igualarAlPiso: true, reglasAdicionalesJson: json });
  const base = { version: 1, exclusiones: [], maximoDescuentoPct: null, maximoPorSku: [], ventanasFecha: [], noEntendido: [] };

  function preparar(json: unknown, promo: Record<string, unknown> = {}) {
    filasPorTabla.set(cuentasMl, [{ id: "cuenta-1", cuentaIdExterna: "123", nickname: "Mi Tienda", siteId: "MLM" }]);
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "60000", costo: "50000" }]);
    filasPorTabla.set(promocionesReglas, [FILA_REGLAS(json)]);
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({
      estado: "ok",
      promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000, start_date: "2026-11-27T00:00:00.000-03:00", finish_date: "2026-11-30T23:59:59.000-03:00", ...promo }],
    });
  }

  it("sin reglas adicionales guardadas: tabla-maestra entra al piso, igual que antes", async () => {
    preparar(null);
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 60000 }));
  });

  it("exclusión por nombre (viene en la promoción): no se escribe y queda la fila omitida con el motivo", async () => {
    preparar({ ...base, exclusiones: [{ tipo: "nombre_promocion", valor: "black friday" }] }, { name: "Black Friday 2026" });
    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(resumen.omitidas).toBe(1);
    expect(resumen.filas[0].error).toContain("Excluida por");
  });

  it("nombre que ML no manda en el ítem: se lee de /seller-promotions/promotions/{id} (una vez)", async () => {
    preparar({ ...base, exclusiones: [{ tipo: "nombre_promocion", valor: "black friday" }] });
    leerNombrePromocionMlMock.mockResolvedValueOnce("Campaña Black Friday");
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(leerNombrePromocionMlMock).toHaveBeenCalledWith("promo-1", "DEAL", "token-falso");
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("nombre imposible de leer: se excluye con «no se pudo leer el nombre» (nunca se adivina)", async () => {
    preparar({ ...base, exclusiones: [{ tipo: "nombre_promocion", valor: "black friday" }] });
    leerNombrePromocionMlMock.mockResolvedValueOnce(null);
    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
    expect(resumen.filas[0].error).toContain("no se pudo leer el nombre");
  });

  it("máximo 20%: entra a 80.000 (limitado), nunca al piso de 60.000", async () => {
    preparar({ ...base, maximoDescuentoPct: 20 });
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 80000 }));
  });

  it("el piso SIEMPRE gana: una regla que permite 60% de descuento no baja de 60.000", async () => {
    preparar({ ...base, maximoDescuentoPct: 60 });
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 60000 }));
  });

  it("ventana de fechas que se cruza con la promoción: no entra", async () => {
    preparar({ ...base, ventanasFecha: [{ desde: "2026-11-29", hasta: "2026-12-02", accion: "no_entrar" }] });
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("NO aplican con «todas» (sin piso) ni con «maximo»", async () => {
    preparar({ ...base, exclusiones: [{ tipo: "tipo_promocion", valor: "deal" }] }, { suggested_discounted_price: 70000 });
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "todas" });
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
    participarPromocionMlMock.mockClear();
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "maximo", maximoPct: 90 });
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
    expect(leerNombrePromocionMlMock).not.toHaveBeenCalled();
  });

  it("un JSON guardado que ya no valida se ignora (nunca se aplica algo sin validar)", async () => {
    preparar({ version: 1, maximoDescuentoPct: 500 });
    await aplicarReglaALote("empresa-1", "usuario-1", SELECCION_MCO1, { tipo: "tabla-maestra" });
    expect(participarPromocionMlMock).toHaveBeenCalledWith("MCO1", "token-falso", expect.objectContaining({ deal_price: 60000 }));
  });

  it("la lista muestra el motivo por promoción (excluida / limitada)", async () => {
    preparar({ ...base, maximoPorSku: [{ sku: "SKU-1", maximoPct: 20 }] });
    listarItemsActivosMlMock.mockResolvedValue({ ids: ["MCO1"], totalCatalogo: 1 });
    const lista = await listarPublicacionesConEstado("empresa-1", { cuentaId: "todas", filtro: "todas", buscar: "", cursor: null, tamanoPagina: 10 });
    expect(lista.filas[0].promociones[0].reglaAdicionalMotivo).toBe("Limitada a 20% por: máximo 20% de descuento en el SKU SKU-1");
  });
});
