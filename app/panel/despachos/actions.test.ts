import { afterEach, describe, expect, it, vi } from "vitest";

// Issue "pendientes no muestra venta nueva" — mismo criterio de mocks
// que app/api/ml/clip/route.test.ts: @/lib/ml/despachos se mockea
// ENTERO (importarlo de verdad exige DATABASE_URL_APP solo por tocar
// db/empresa-context.ts) — acá solo interesa sincronizarAhoraAction,
// la glue que llama a traerVentasDelMes (ya con su propia prueba en
// lib/finanzas/traer-ventas-mes.test.ts).
vi.mock("next/headers", () => ({ cookies: vi.fn(() => ({ get: () => ({ value: "empresa-1" }) })) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/ml/despachos", () => ({
  deshacerDespachado: vi.fn(),
  marcarDespachado: vi.fn(),
  DespachoNoEncontradoError: class extends Error {},
  GuiaNoVistaError: class extends Error {},
  VentanaDeshacerVencidaError: class extends Error {},
}));

const traerVentasDelMesMock = vi.fn();
vi.mock("@/lib/finanzas/traer-ventas-mes", () => ({
  traerVentasDelMes: (...args: unknown[]) => traerVentasDelMesMock(...args),
  textoResultadoCuenta: (r: { ok: boolean; nickname: string; error?: string; sync?: { leidas: number; guardadas: number } }) =>
    r.ok ? `${r.nickname}: ${r.sync!.guardadas} de ${r.sync!.leidas} ventas guardadas.` : `${r.nickname}: ${r.error}`,
}));

import { SinPermisoError } from "@/lib/permisos";
import { sincronizarAhoraAction } from "./actions";

describe("sincronizarAhoraAction (issue 'pendientes no muestra venta nueva')", () => {
  afterEach(() => traerVentasDelMesMock.mockReset());

  it("llama a traerVentasDelMes con la empresa/usuario de la sesión y SIN cuenta fija (todas las conectadas)", async () => {
    traerVentasDelMesMock.mockResolvedValue([]);
    await sincronizarAhoraAction();
    expect(traerVentasDelMesMock).toHaveBeenCalledWith("empresa-1", "usuario-1", null, expect.any(Date));
  });

  it("sin cuentas conectadas, devuelve un error claro (nunca un 'ok' vacío)", async () => {
    traerVentasDelMesMock.mockResolvedValue([]);
    const resultado = await sincronizarAhoraAction();
    expect(resultado).toEqual({ ok: false, error: "No hay cuentas de Mercado Libre conectadas para sincronizar." });
  });

  it("con éxito, junta el resumen de cada cuenta en un solo texto", async () => {
    traerVentasDelMesMock.mockResolvedValue([
      { cuentaMlId: "c1", nickname: "STOREKINGSAS", ok: true, sync: { leidas: 5, guardadas: 5, congeladas: 1, fallidas: 0, cortadaPorLimite: false } },
    ]);
    const resultado = await sincronizarAhoraAction();
    expect(resultado).toEqual({ ok: true, resumen: "STOREKINGSAS: 5 de 5 ventas guardadas." });
  });

  it("sin permiso de finanzas/modificar, devuelve el mensaje real del error (nunca un 500 crudo)", async () => {
    traerVentasDelMesMock.mockRejectedValue(new SinPermisoError("finanzas", "modificar"));
    const resultado = await sincronizarAhoraAction();
    expect(resultado).toEqual({ ok: false, error: 'No tienes permiso para "modificar" en "finanzas".' });
  });
});
