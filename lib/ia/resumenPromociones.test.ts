import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ia/conexion", () => ({ obtenerConexionIAConClave: vi.fn() }));
vi.mock("@/lib/ia/proveedores", () => ({ llamarIA: vi.fn() }));

import { obtenerConexionIAConClave } from "@/lib/ia/conexion";
import { llamarIA } from "@/lib/ia/proveedores";
import type { CandidatoCalculado } from "@/lib/ml/promociones";
import { resumenPromocionesIA } from "./resumenPromociones";

function candidato(overrides: Partial<CandidatoCalculado> = {}): CandidatoCalculado {
  return {
    cuentaMlId: "c1",
    itemId: "MCO1",
    skuCodigo: "SKU-1",
    tituloProducto: "Producto",
    thumbnail: null,
    tieneVariantes: false,
    tipoPromocion: "DEAL",
    promotionIdMl: null,
    estadoMl: "candidate",
    esCompartida: false,
    soloEnMl: false,
    precioOriginal: 100000,
    precioActual: null,
    precioMinimo: 90000,
    precioSugerido: 90000,
    maxDiscountedPrice: null,
    gananciaEstimada: 40000,
    cumpleReglas: true,
    accionSugerida: "participar",
    motivoRevisarManual: null,
    ...overrides,
  };
}

// Rama feat-promociones, punto 6 — "sin IA conectada, el módulo
// funciona igual" y "los números siempre salen del motor de reglas,
// la IA solo explica". Acá solo se prueba que resumenPromocionesIA
// nunca rompe el flujo de Promociones, en ningún escenario.
describe("resumenPromocionesIA — rama feat-promociones", () => {
  it("sin candidatos: null, nunca llama a la conexión", async () => {
    await expect(resumenPromocionesIA("empresa-1", [])).resolves.toBeNull();
    expect(obtenerConexionIAConClave).not.toHaveBeenCalled();
  });

  it("sin conexión de IA configurada: null, nunca lanza", async () => {
    vi.mocked(obtenerConexionIAConClave).mockResolvedValueOnce(null);
    await expect(resumenPromocionesIA("empresa-1", [candidato()])).resolves.toBeNull();
    expect(llamarIA).not.toHaveBeenCalled();
  });

  it("con conexión real: llama a llamarIA con el JSON de los candidatos ya calculados y devuelve su texto", async () => {
    vi.mocked(obtenerConexionIAConClave).mockResolvedValueOnce({
      id: "ia-1",
      proveedor: "anthropic",
      baseUrl: null,
      modelo: "claude-sonnet-5",
      actualizadoTs: new Date(),
      apiKey: "clave-real",
    });
    vi.mocked(llamarIA).mockResolvedValueOnce("2 productos listos, ganancia total estimada $80.000.");
    const resultado = await resumenPromocionesIA("empresa-1", [candidato()]);
    expect(resultado).toBe("2 productos listos, ganancia total estimada $80.000.");
    const [, prompt] = vi.mocked(llamarIA).mock.calls[0]!;
    expect(prompt).toContain("Producto");
    expect(prompt).not.toContain("clave-real");
  });

  it("si la IA falla (clave vencida, proveedor caído): null, nunca rompe el módulo", async () => {
    vi.mocked(obtenerConexionIAConClave).mockResolvedValueOnce({
      id: "ia-1",
      proveedor: "anthropic",
      baseUrl: null,
      modelo: "claude-sonnet-5",
      actualizadoTs: new Date(),
      apiKey: "clave-real",
    });
    vi.mocked(llamarIA).mockRejectedValueOnce(new Error("proveedor caído"));
    await expect(resumenPromocionesIA("empresa-1", [candidato()])).resolves.toBeNull();
  });
});
