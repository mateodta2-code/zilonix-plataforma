import { afterEach, describe, expect, it, vi } from "vitest";

// Rama feat-promociones — mismo motivo de siempre para mockear ANTES
// de cualquier import real: este trabajo toca Postgres (dbComoEmpresa,
// para reglas/costos/upsert de candidatos) y Mercado Libre
// (obtenerAccessTokenVigente) — ninguno de los dos existe en este
// sandbox. dbComoEmpresa se reemplaza por una versión FALSA que corre
// el callback contra una "tx" mínima: select().from(tabla).where()
// devuelve lo programado SEGÚN LA TABLA pedida (comparando por
// referencia, nunca por orden de llamada — así el test no depende de
// en qué orden el código real decide consultar reglas vs. costos),
// insert().values().onConflictDoUpdate() solo registra lo que se
// intentó guardar, para poder revisarlo después.
const { registroUpserts, filasPorTabla } = vi.hoisted(() => ({
  registroUpserts: [] as unknown[],
  filasPorTabla: new Map<unknown, unknown[]>(),
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
        values: (valores: unknown) => ({
          onConflictDoUpdate: async () => {
            registroUpserts.push(valores);
            return [];
          },
        }),
      }),
    };
    return fn(tx);
  },
}));

vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn(async () => "token-falso") }));

const { listarTodosLosItemsActivosMock, leerPromocionesDeItemMock, calcularCandidatosItemMock } = vi.hoisted(() => ({
  listarTodosLosItemsActivosMock: vi.fn(),
  leerPromocionesDeItemMock: vi.fn(),
  calcularCandidatosItemMock: vi.fn(),
}));
vi.mock("@/lib/ml/promociones", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/promociones")>();
  return {
    ...real,
    listarTodosLosItemsActivos: listarTodosLosItemsActivosMock,
    leerPromocionesDeItem: leerPromocionesDeItemMock,
    calcularCandidatosItem: calcularCandidatosItemMock,
  };
});

import { promocionesReglas, costosSku } from "@/db/schema";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";
import { iniciarBusquedaPromociones, obtenerTrabajoBusquedaPromociones } from "./buscarPromocionesMultiCuenta";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function esperarTrabajoTerminado(jobId: string, empresaId: string, maxEsperaMs = 2000) {
  const inicio = Date.now();
  while (Date.now() - inicio < maxEsperaMs) {
    const trabajo = obtenerTrabajoBusquedaPromociones(jobId, empresaId);
    if (trabajo?.terminadoTs != null) return trabajo;
    await esperar(5);
  }
  throw new Error("El trabajo no terminó a tiempo.");
}

describe("iniciarBusquedaPromociones/obtenerTrabajoBusquedaPromociones — rama feat-promociones, punto 4", () => {
  afterEach(() => {
    vi.clearAllMocks();
    registroUpserts.length = 0;
    filasPorTabla.clear();
  });

  it("busca en varias cuentas, cada una termina 'listo' y guarda sus candidatos (upsert)", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({ ids: ["MCO1", "MCO2"], catalogoIncompleto: false });
    leerPromocionesDeItemMock.mockImplementation(async (itemId: string, cuentaMlId: string) => ({
      estado: "con_promos",
      item: {
        itemId,
        cuentaMlId,
        nickname: "n",
        tituloProducto: "Producto",
        thumbnail: null,
        skuCodigo: null,
        tieneVariantes: false,
        promociones: [{ type: "DEAL", status: "candidate" }],
      },
    }));
    calcularCandidatosItemMock.mockImplementation((item: { itemId: string }) => [
      { itemId: item.itemId, tipoPromocion: "DEAL", cumpleReglas: true, accionSugerida: "participar" },
    ]);

    const jobId = iniciarBusquedaPromociones("empresa-1", [
      { cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" },
      { cuentaMlId: "c2", cuentaId: "c2", cuentaIdExterna: "222", nickname: "Cuenta 2" },
    ]);
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-1");

    expect(trabajo?.cuentas.every((c) => c.estado === "listo")).toBe(true);
    expect(trabajo?.cuentas.every((c) => c.productosRevisados === 2 && c.itemsConPromociones === 2)).toBe(true);
    expect(registroUpserts.length).toBe(4); // 2 cuentas x 2 items
  });

  it("una cuenta falla (429 agotado), la otra sigue y termina bien — fallas parciales", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockImplementation(async (cuentaIdExterna: string) => {
      if (cuentaIdExterna === "111") throw new LimiteMercadoLibreError(1000);
      return { ids: ["MCO1"], catalogoIncompleto: false };
    });
    leerPromocionesDeItemMock.mockResolvedValue({ estado: "sin_promos" });

    const jobId = iniciarBusquedaPromociones("empresa-2", [
      { cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" },
      { cuentaMlId: "c2", cuentaId: "c2", cuentaIdExterna: "222", nickname: "Cuenta 2" },
    ]);
    // 3 reintentos reales ante 429 (2s/4s/6s de backoff) antes de darse
    // por vencido — esta prueba espera ese tiempo real a propósito,
    // nunca acelera el reloj (mismo criterio que el resto del repo:
    // nunca inventar un atajo que no exista en el código real).
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-2", 15000);

    const filaC1 = trabajo?.cuentas.find((c) => c.cuentaId === "c1");
    const filaC2 = trabajo?.cuentas.find((c) => c.cuentaId === "c2");
    expect(filaC1?.estado).toBe("error");
    expect(filaC2?.estado).toBe("listo");
  }, 20000);

  it("devuelve el id de inmediato (nunca espera a que termine la búsqueda)", () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockImplementation(async () => {
      await esperar(500);
      return { ids: [], catalogoIncompleto: false };
    });
    const antes = Date.now();
    const jobId = iniciarBusquedaPromociones("empresa-3", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    expect(Date.now() - antes).toBeLessThan(100);
    expect(typeof jobId).toBe("string");
  });

  it("RLS a mano — un trabajo nunca se devuelve para una empresa distinta a la que lo creó", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({ ids: [], catalogoIncompleto: false });
    const jobId = iniciarBusquedaPromociones("empresa-dueña", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    expect(obtenerTrabajoBusquedaPromociones(jobId, "empresa-ajena")).toBeNull();
    await esperarTrabajoTerminado(jobId, "empresa-dueña");
  });

  it("un jobId inexistente: null, nunca lanza", () => {
    expect(obtenerTrabajoBusquedaPromociones("no-existe", "empresa-1")).toBeNull();
  });

  // MED 8 (review de Pablo) — cuando la paginación por offset corta
  // antes de terminar el catálogo real, el aviso tiene que llegar hasta
  // el progreso de esa cuenta (nunca en silencio).
  it("catalogoIncompleto:true de listarTodosLosItemsActivos llega hasta el progreso de la cuenta", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({ ids: ["MCO1"], catalogoIncompleto: true });
    leerPromocionesDeItemMock.mockResolvedValue({ estado: "sin_promos" });

    const jobId = iniciarBusquedaPromociones("empresa-4", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-4");

    expect(trabajo?.cuentas[0]?.catalogoIncompleto).toBe(true);
  });

  it("catalogoIncompleto:false por defecto cuando la paginación terminó completa", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({ ids: [], catalogoIncompleto: false });

    const jobId = iniciarBusquedaPromociones("empresa-5", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-5");

    expect(trabajo?.cuentas[0]?.catalogoIncompleto).toBe(false);
  });

  // Bug real en staging (rama fix-promociones-buscar, Refs #44) — la
  // sospecha fuerte era seller-promotions devolviendo 403 (sin el
  // scope de Promociones) en silencio, terminando "Listo (0/N)" sin
  // ningún aviso. Acá se confirma el arreglo: el umbral de 403 frena
  // la cuenta con un mensaje claro, nunca termina "listo" en silencio.
  it("umbral de 403 (sin_permiso) en seller-promotions: la cuenta queda 'error' con el mensaje de reconectar, nunca 'listo' en silencio", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({
      ids: Array.from({ length: 20 }, (_, i) => `MCO${i}`),
      catalogoIncompleto: false,
    });
    leerPromocionesDeItemMock.mockResolvedValue({ estado: "sin_permiso" });

    const jobId = iniciarBusquedaPromociones("empresa-6", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-6");

    const fila = trabajo?.cuentas[0];
    expect(fila?.estado).toBe("error");
    expect(fila?.error).toContain("Reconectá esta cuenta en Conectar Mercado Libre");
    expect(fila?.error).toContain("Promociones");
    expect(registroUpserts.length).toBe(0); // nunca llega a guardar candidatos de una cuenta que se frenó por falta de permiso
    // Review de Pablo — productosRevisados cuenta lo que de verdad se
    // pidió a Mercado Libre, nunca ids.length de entrada: con el umbral
    // del módulo en 5 y 20 ids, el resumen nunca puede salir "inflado" a 20.
    expect(fila?.productosRevisados).toBeGreaterThanOrEqual(5);
    expect(fila?.productosRevisados).toBeLessThan(20);
  });

  // Review de Pablo — el primer diseño lanzaba PromocionesSinPermisoError
  // desde CADA worker que cruzara el umbral; con varios workers
  // concurrentes viendo el mismo contador compartido, más de uno podía
  // cruzarlo casi al mismo tiempo y volver a lanzar — riesgo real de
  // unhandledRejection entre los workers hermanos de conConcurrenciaLimitada.
  // Ahora es un flag compartido que los workers solo LEEN (nunca lanzan).
  it("al cruzar el umbral de 403, ningún worker hermano deja una unhandledRejection", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({
      ids: Array.from({ length: 20 }, (_, i) => `MCO${i}`),
      catalogoIncompleto: false,
    });
    leerPromocionesDeItemMock.mockResolvedValue({ estado: "sin_permiso" });

    const rechazosNoAtendidos: unknown[] = [];
    const alRechazoNoAtendido = (razon: unknown) => rechazosNoAtendidos.push(razon);
    process.on("unhandledRejection", alRechazoNoAtendido);

    try {
      const jobId = iniciarBusquedaPromociones("empresa-10", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
      const trabajo = await esperarTrabajoTerminado(jobId, "empresa-10");
      // Una vuelta extra del loop de eventos para darle tiempo a
      // cualquier rejection tardía de un worker hermano a aparecer.
      await esperar(50);

      expect(trabajo?.cuentas[0]?.estado).toBe("error");
      expect(rechazosNoAtendidos).toEqual([]);
    } finally {
      process.off("unhandledRejection", alRechazoNoAtendido);
    }
  });

  it("menos del umbral de 403: la cuenta sigue normal, un par de ítems puntuales nunca la frenan", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({ ids: ["MCO1", "MCO2", "MCO3"], catalogoIncompleto: false });
    let llamada = 0;
    leerPromocionesDeItemMock.mockImplementation(async () => {
      llamada += 1;
      return llamada <= 2 ? { estado: "sin_permiso" } : { estado: "sin_promos" };
    });

    const jobId = iniciarBusquedaPromociones("empresa-7", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-7");

    expect(trabajo?.cuentas[0]?.estado).toBe("listo");
    expect(trabajo?.cuentas[0]?.error).toBeNull();
  });

  it("no_autorizado (401) y otro_error nunca frenan la cuenta por sí solos (solo sin_permiso/403 lo hace)", async () => {
    filasPorTabla.set(promocionesReglas, []);
    filasPorTabla.set(costosSku, []);
    listarTodosLosItemsActivosMock.mockResolvedValue({ ids: ["MCO1", "MCO2", "MCO3", "MCO4"], catalogoIncompleto: false });
    let llamada = 0;
    leerPromocionesDeItemMock.mockImplementation(async () => {
      llamada += 1;
      if (llamada === 1) return { estado: "no_autorizado" };
      if (llamada === 2) return { estado: "otro_error" };
      return { estado: "sin_promos" };
    });

    const jobId = iniciarBusquedaPromociones("empresa-8", [{ cuentaMlId: "c1", cuentaId: "c1", cuentaIdExterna: "111", nickname: "Cuenta 1" }]);
    const trabajo = await esperarTrabajoTerminado(jobId, "empresa-8");

    expect(trabajo?.cuentas[0]?.estado).toBe("listo");
  });
});
