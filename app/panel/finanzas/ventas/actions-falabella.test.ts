import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #422 — traerVentasFalabellaAction, solo la glue: permiso, rango
// desde el día 1 del mes en Bogotá y que una cuenta que falla no corte el
// resto. La base y Falabella se simulan (importarPedidos ya tiene sus
// pruebas; la lectura de cuentas va con RLS por dbComoEmpresa). Archivo
// aparte de actions.test.ts porque aquel corre contra Postgres real.

const estado = vi.hoisted(() => ({ cuentas: [] as { id: string; nickname: string }[] }));
const importarPedidosMock = vi.hoisted(() => vi.fn());
const registrarAuditoriaMock = vi.hoisted(() => vi.fn(async () => undefined));
const requierePermisoMock = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/empresa-context", () => {
  const consulta = { select: () => consulta, from: () => consulta, where: async () => estado.cuentas };
  return { dbComoEmpresa: vi.fn(async (_empresaId: string, fn: (tx: unknown) => unknown) => fn(consulta)) };
});
vi.mock("@/lib/panel-contexto", () => ({
  obtenerContextoPanel: async () => ({ usuario: { id: "usuario-1" }, activa: { id: "empresa-1" } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { requierePermiso: requierePermisoMock, SinPermisoError };
});
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: registrarAuditoriaMock }));
vi.mock("@/lib/falabella/pedidos", () => ({ importarPedidos: importarPedidosMock }));

import { SinPermisoError } from "@/lib/permisos";
import { traerVentasFalabellaAction } from "./actions";

describe("traerVentasFalabellaAction (issue #422)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    estado.cuentas = [
      { id: "cuenta-a", nickname: "Tienda A" },
      { id: "cuenta-b", nickname: "Tienda B" },
      { id: "cuenta-c", nickname: "Tienda C" },
    ];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("pide finanzas.modificar y, sin permiso, no lee cuentas ni llama a Falabella", async () => {
    requierePermisoMock.mockRejectedValueOnce(new SinPermisoError("finanzas", "modificar"));
    const r = await traerVentasFalabellaAction();
    expect(requierePermisoMock).toHaveBeenCalledWith("usuario-1", "empresa-1", "finanzas", "modificar");
    expect(r).toMatchObject({ ok: false, importados: 0, mensaje: "Tu rol no puede traer ventas de Falabella." });
    expect(importarPedidosMock).not.toHaveBeenCalled();
    expect(registrarAuditoriaMock).not.toHaveBeenCalled();
  });

  it("trae desde las 00:00 del día 1 del mes en Bogotá, aunque en UTC ya sea el mes siguiente", async () => {
    // 1 de diciembre 03:00 UTC = 30 de noviembre 22:00 en Bogotá.
    vi.setSystemTime(new Date("2026-12-01T03:00:00Z"));
    importarPedidosMock.mockResolvedValue({ importados: 0, truncado: false });
    await traerVentasFalabellaAction();
    const desde = importarPedidosMock.mock.calls[0][2] as Date;
    expect(desde.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(importarPedidosMock).toHaveBeenCalledWith("empresa-1", "cuenta-a", desde);
  });

  it("si una cuenta falla, sigue con las demás, suma lo traído y la nombra", async () => {
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    importarPedidosMock
      .mockResolvedValueOnce({ importados: 4, truncado: false })
      .mockRejectedValueOnce(new Error("E009 Access Denied"))
      .mockResolvedValueOnce({ importados: 2, truncado: false });
    const r = await traerVentasFalabellaAction();
    expect(importarPedidosMock).toHaveBeenCalledTimes(3);
    expect(r).toMatchObject({ ok: false, importados: 6, cuentasFallidas: ["Tienda B"] });
    expect(r.mensaje).toContain("Tienda B");
    expect(registrarAuditoriaMock).toHaveBeenCalledTimes(1);
    expect(registrarAuditoriaMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ empresaId: "empresa-1", usuarioId: "usuario-1", entidad: "pedido_falabella", detalle: expect.stringContaining("Fallaron: Tienda B") })
    );
  });

  it("sin cuentas conectadas devuelve un aviso claro y no llama a Falabella", async () => {
    estado.cuentas = [];
    const r = await traerVentasFalabellaAction();
    expect(r).toMatchObject({ ok: false, importados: 0, mensaje: "No hay cuentas de Falabella conectadas para traer ventas." });
    expect(importarPedidosMock).not.toHaveBeenCalled();
  });
});
