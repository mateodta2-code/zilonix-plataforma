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
        values: (valores: Record<string, unknown>) => ({
          returning: async () => {
            insertsRegistrados.push(valores);
            return [{ id: `accion-${insertsRegistrados.length}` }];
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

const {
  leerItemParaPromocionMlMock,
  leerPromocionesItemMlMock,
  listarItemsActivosMlMock,
  participarPromocionMlMock,
  modificarPromocionMlMock,
} = vi.hoisted(() => ({
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
  };
});

import { costosSku, cuentasMl } from "@/db/schema";
import {
  aplicarReglaALote,
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

describe("aplicarReglaALote", () => {
  function prepararCuenta() {
    filasPorTabla.set(cuentasMl, [{ id: "cuenta-1", cuentaIdExterna: "123", nickname: "Mi Tienda", siteId: "MCO" }]);
  }

  it("regla 'todas': participa en cada candidato que cumple reglas", async () => {
    prepararCuenta();
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: ["MCO1"], totalCatalogo: 1 });
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", "todas", { tipo: "todas" });

    expect(resumen.participadas).toBe(1);
    expect(resumen.fallidas).toBe(0);
    expect(participarPromocionMlMock).toHaveBeenCalledTimes(1);
  });

  it("regla 'maximo': descarta candidatos cuyo descuento supera el tope elegido, sin llamar a Mercado Libre para esos", async () => {
    prepararCuenta();
    // Piso 90.000 sobre un original de 100.000 = 10% de descuento real.
    filasPorTabla.set(costosSku, [{ skuCodigo: "SKU-1", precioMinimoUnidad: "90000", costo: "50000" }]);
    listarItemsActivosMlMock.mockResolvedValueOnce({ ids: ["MCO1"], totalCatalogo: 1 });
    leerItemParaPromocionMlMock.mockResolvedValue(itemBasico());
    leerPromocionesItemMlMock.mockResolvedValue({ estado: "ok", promociones: [{ type: "DEAL", status: "candidate", id: "promo-1", original_price: 100000 }] });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", "todas", { tipo: "maximo", maximoPct: 5 });

    expect(resumen.participadas).toBe(0);
    expect(participarPromocionMlMock).not.toHaveBeenCalled();
  });

  it("una cuenta sin token válido se salta sin romper el lote", async () => {
    filasPorTabla.set(cuentasMl, [{ id: "cuenta-rota", cuentaIdExterna: "1", nickname: "Rota", siteId: "MCO" }]);
    obtenerAccessTokenVigenteMock.mockImplementationOnce(async () => {
      throw new Error("token vencido");
    });

    const resumen = await aplicarReglaALote("empresa-1", "usuario-1", "todas", { tipo: "todas" });
    expect(resumen.revisadas).toBe(0);
    expect(listarItemsActivosMlMock).not.toHaveBeenCalled();
  });
});
