import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #175 — mockea las dos capas que diagnostico.ts orquesta
// (lib/ml/cuentas para el token, lib/ml/cliente para las 3 llamadas
// reales) para probar SOLO su propia lógica: resolver la cuenta propia
// antes de llamar, y nunca dejar que el token salga en el resultado.
vi.mock("@/lib/ml/cuentas", () => ({
  obtenerCuentaMlActiva: vi.fn(),
  obtenerAccessTokenVigente: vi.fn(),
}));
vi.mock("@/lib/ml/cliente", () => ({
  diagnosticoItemMl: vi.fn(),
  diagnosticoVendedorMl: vi.fn(),
  diagnosticoCatalogoMl: vi.fn(),
}));

import { obtenerAccessTokenVigente, obtenerCuentaMlActiva } from "@/lib/ml/cuentas";
import { diagnosticoCatalogoMl, diagnosticoItemMl, diagnosticoVendedorMl } from "@/lib/ml/cliente";
import { diagnosticarCatalogo, diagnosticarItem, diagnosticarVendedor, SinCuentaMlParaDiagnosticoError } from "./diagnostico";

const TOKEN_SECRETO = "token-de-la-cuenta-propia-secreto";

describe("lib/ml/diagnostico — resuelve el token propio antes de llamar a cliente.ts (issue #175)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(obtenerCuentaMlActiva).mockResolvedValue({ id: "cuenta-1" });
    vi.mocked(obtenerAccessTokenVigente).mockResolvedValue(TOKEN_SECRETO);
  });

  afterEach(() => vi.restoreAllMocks());

  it("sin ninguna cuenta ML conectada: SinCuentaMlParaDiagnosticoError, nunca llega a llamar a cliente.ts", async () => {
    vi.mocked(obtenerCuentaMlActiva).mockResolvedValue(null);
    await expect(diagnosticarItem("empresa-1", "MCO111")).rejects.toThrow(SinCuentaMlParaDiagnosticoError);
    expect(diagnosticoItemMl).not.toHaveBeenCalled();
    expect(obtenerAccessTokenVigente).not.toHaveBeenCalled();
  });

  it("diagnosticarItem: pide el token de la cuenta activa y lo pasa a diagnosticoItemMl", async () => {
    vi.mocked(diagnosticoItemMl).mockResolvedValue({ status: 200, data: { price: 100 } });

    const resultado = await diagnosticarItem("empresa-1", "MCO111");

    expect(obtenerAccessTokenVigente).toHaveBeenCalledWith("empresa-1", "cuenta-1");
    expect(diagnosticoItemMl).toHaveBeenCalledWith("MCO111", TOKEN_SECRETO);
    expect(resultado).toEqual({ status: 200, data: { price: 100 } });
    expect(JSON.stringify(resultado)).not.toContain(TOKEN_SECRETO);
  });

  it("diagnosticarVendedor: pide el token y lo pasa a diagnosticoVendedorMl", async () => {
    vi.mocked(diagnosticoVendedorMl).mockResolvedValue({
      itemsSearch: { status: 200, cantidadResultados: 3 },
      sitesSearch: { status: 200, cantidadResultados: 5 },
    });

    const resultado = await diagnosticarVendedor("empresa-1", "987654321");

    expect(diagnosticoVendedorMl).toHaveBeenCalledWith("987654321", TOKEN_SECRETO);
    expect(resultado.itemsSearch.cantidadResultados).toBe(3);
    expect(JSON.stringify(resultado)).not.toContain(TOKEN_SECRETO);
  });

  it("diagnosticarCatalogo: pide el token y lo pasa a diagnosticoCatalogoMl", async () => {
    vi.mocked(diagnosticoCatalogoMl).mockResolvedValue({
      status: 200,
      totalOfertas: 1,
      primeraOferta: { item_id: "MCO1" },
      camposGanadorEncontrados: [],
    });

    const resultado = await diagnosticarCatalogo("empresa-1", "MCO999");

    expect(diagnosticoCatalogoMl).toHaveBeenCalledWith("MCO999", TOKEN_SECRETO);
    expect(resultado.totalOfertas).toBe(1);
    expect(JSON.stringify(resultado)).not.toContain(TOKEN_SECRETO);
  });

  it("un error real de obtenerAccessTokenVigente (ej. cuenta desconectada) sube tal cual, nunca se traga", async () => {
    vi.mocked(obtenerAccessTokenVigente).mockRejectedValue(new Error("Esta cuenta está desconectada."));
    await expect(diagnosticarItem("empresa-1", "MCO111")).rejects.toThrow("Esta cuenta está desconectada.");
    expect(diagnosticoItemMl).not.toHaveBeenCalled();
  });
});
