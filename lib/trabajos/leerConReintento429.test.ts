import { afterEach, describe, expect, it, vi } from "vitest";
import { LimiteMercadoLibreError } from "@/lib/ml/cliente";

// Issue #175 — este archivo nunca toca Postgres (leerConReintento429
// solo reintenta leerFotoSeguimiento, nada de base de datos) — pero
// igual tiene que mockear los dos módulos de conexión que
// revisionDiariaSeguimiento.ts importa a nivel de archivo:
// @/db/trabajador-seguimiento-context (revienta al CARGARSE si falta
// DATABASE_URL_SEGUIMIENTO, mismo patrón que db/trabajador-context.ts)
// y @/db/empresa-context (revienta igual si falta DATABASE_URL_APP —
// lo importa tanto revisionDiariaSeguimiento.ts como, transitivo,
// lib/ml/cuentas.ts). Un simple
// `import { leerConReintento429 } from "./revisionDiariaSeguimiento"`
// ya arrastra las dos, aunque esta prueba puntual nunca las use.
// Separado de revisionDiariaSeguimiento.test.ts (que sí necesita las
// conexiones reales, para sus pruebas de punta a punta contra
// Postgres) para que este archivo, puro y rápido, nunca dependa de
// esas variables.
vi.mock("@/db/trabajador-seguimiento-context", () => ({ dbTrabajadorSeguimiento: {} }));
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));
vi.mock("@/lib/seguimiento/lector", () => ({ leerFotoSeguimiento: vi.fn() }));

describe("leerConReintento429 — reintento con espera creciente en 429 (issue #175)", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("429 dos veces y OK a la tercera: reintenta con espera creciente, sin fallar", async () => {
    const { leerConReintento429 } = await import("./revisionDiariaSeguimiento");
    const { leerFotoSeguimiento } = await import("@/lib/seguimiento/lector");
    const datosFinal = {
      precio: 100,
      precioAnterior: null,
      inventarioDisponible: null,
      inventarioAproximado: false,
      vendidos: null,
      estado: null,
      enCatalogo: null,
      ganaBotonCompra: null,
      esFull: null,
      esEnvioGratis: null,
      publicaciones: null,
    };
    vi.mocked(leerFotoSeguimiento)
      .mockRejectedValueOnce(new LimiteMercadoLibreError())
      .mockRejectedValueOnce(new LimiteMercadoLibreError())
      .mockResolvedValueOnce(datosFinal);

    vi.useFakeTimers();
    const promesa = leerConReintento429({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", "123");
    await vi.runAllTimersAsync();
    const resultado = await promesa;

    expect(resultado).toEqual(datosFinal);
    expect(leerFotoSeguimiento).toHaveBeenCalledTimes(3);
  });

  it("429 todas las veces (más de lo que se reintenta): termina lanzando LimiteMercadoLibreError", async () => {
    const { leerConReintento429 } = await import("./revisionDiariaSeguimiento");
    const { leerFotoSeguimiento } = await import("@/lib/seguimiento/lector");
    vi.mocked(leerFotoSeguimiento).mockRejectedValue(new LimiteMercadoLibreError());

    vi.useFakeTimers();
    const promesa = leerConReintento429({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", "123").catch((e) => e);
    await vi.runAllTimersAsync();
    const resultado = await promesa;

    expect(resultado).toBeInstanceOf(LimiteMercadoLibreError);
  });

  it("un error que no es 429 nunca se reintenta — sube de una", async () => {
    const { leerConReintento429 } = await import("./revisionDiariaSeguimiento");
    const { leerFotoSeguimiento } = await import("@/lib/seguimiento/lector");
    const otroError = new Error("otra cosa");
    vi.mocked(leerFotoSeguimiento).mockRejectedValue(otroError);

    await expect(leerConReintento429({ tipo: "producto", recursoMl: "item", mlIdExterno: "MCO111" }, "token", "123")).rejects.toBe(otroError);
    expect(leerFotoSeguimiento).toHaveBeenCalledTimes(1);
  });
});
