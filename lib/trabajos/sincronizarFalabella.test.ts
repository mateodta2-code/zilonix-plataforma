import { beforeEach, describe, expect, it, vi } from "vitest";

const cuentasActivas = vi.hoisted(() => ({ filas: [] as { id: string; empresaId: string }[] }));

vi.mock("@/db/trabajador-falabella-context", () => {
  const consulta = {
    from: () => consulta,
    where: () => consulta,
    orderBy: () => Promise.resolve(cuentasActivas.filas),
  };
  return { dbTrabajadorFalabella: { select: () => consulta } };
});
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: vi.fn(async (_empresaId: string, fn: (tx: unknown) => Promise<unknown>) => fn({})),
}));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));
vi.mock("@/lib/falabella/pedidos", () => ({ importarPedidos: vi.fn() }));

import { registrarAuditoria } from "@/lib/auditoria";
import { importarPedidos } from "@/lib/falabella/pedidos";
import { errorSeguro, sincronizarFalabellaProgramada } from "./sincronizarFalabella";

const EMPRESA_A = "11111111-1111-4111-8111-111111111111";
const EMPRESA_B = "22222222-2222-4222-8222-222222222222";

describe("sincronizarFalabellaProgramada (issue #422)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    cuentasActivas.filas = [
      { id: "cuenta-1", empresaId: EMPRESA_A },
      { id: "cuenta-2", empresaId: EMPRESA_A },
      { id: "cuenta-3", empresaId: EMPRESA_B },
    ];
  });

  it("pide exactamente los últimos 3 días a cada cuenta", async () => {
    vi.mocked(importarPedidos).mockResolvedValue({ importados: 0, truncado: false });
    const ahora = new Date("2026-11-24T15:00:00.000Z");

    const resumen = await sincronizarFalabellaProgramada(ahora);

    const esperado = new Date("2026-11-21T15:00:00.000Z");
    expect(resumen.desde).toBe(esperado.toISOString());
    expect(importarPedidos).toHaveBeenCalledTimes(3);
    for (const llamada of vi.mocked(importarPedidos).mock.calls) {
      expect(llamada[2].getTime()).toBe(esperado.getTime());
    }
    expect(importarPedidos).toHaveBeenCalledWith(EMPRESA_B, "cuenta-3", esperado);
  });

  it("una cuenta que falla no corta el resto y queda auditada como sistema", async () => {
    vi.mocked(importarPedidos)
      .mockResolvedValueOnce({ importados: 5, truncado: false })
      .mockRejectedValueOnce(new Error("Falabella respondió 500 en https://sellercenter-api.falabella.com/?Signature=abc para vendedor@tienda.co"))
      .mockResolvedValueOnce({ importados: 2, truncado: true });

    const resumen = await sincronizarFalabellaProgramada(new Date("2026-11-24T15:00:00.000Z"));

    expect(importarPedidos).toHaveBeenCalledTimes(3);
    expect(resumen).toMatchObject({ revisadas: 3, correctas: 2, fallidas: 1 });
    expect(resumen.cuentas).toEqual([
      { cuentaId: "cuenta-1", ok: true, importados: 5, truncado: false },
      { cuentaId: "cuenta-2", ok: false, error: "Error" },
      { cuentaId: "cuenta-3", ok: true, importados: 2, truncado: true },
    ]);

    expect(registrarAuditoria).toHaveBeenCalledTimes(1);
    const entrada = vi.mocked(registrarAuditoria).mock.calls[0][1];
    expect(entrada).toMatchObject({ empresaId: EMPRESA_A, usuarioId: null, actorTipo: "sistema", entidadId: "cuenta-2" });
    expect(entrada.detalle).not.toMatch(/Signature=abc|vendedor@tienda\.co|https:/);
    expect(JSON.stringify(resumen)).not.toMatch(/Signature|vendedor@|https:/);
  });

  it("si la auditoría también falla, igual sigue con las demás cuentas", async () => {
    vi.mocked(importarPedidos).mockRejectedValueOnce(new Error("x")).mockResolvedValue({ importados: 1, truncado: false });
    vi.mocked(registrarAuditoria).mockRejectedValueOnce(new Error("base caída"));

    const resumen = await sincronizarFalabellaProgramada();

    expect(resumen).toMatchObject({ revisadas: 3, correctas: 2, fallidas: 1 });
  });

  it("errorSeguro quita URLs, correos y firmas", () => {
    const texto = errorSeguro(new Error("falló https://x.test/?a=1 de a@b.co con Signature=zzz"));
    expect(texto).not.toMatch(/https|a@b\.co|zzz/);
  });
});
