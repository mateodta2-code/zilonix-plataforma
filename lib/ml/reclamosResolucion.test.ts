import { beforeEach, describe, expect, it, vi } from "vitest";

const escribir = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return { ...real, escribirMl: escribir };
});

import type { ReclamoBaseMl } from "@/lib/ml/reclamos";
import { leerOfertasReembolsoParcialMl, ofrecerDevolucionMl, ofrecerReembolsoParcialMl, pedirMediacionMl, reembolsoTotalMl, valorPorcentaje } from "./reclamosResolucion";

function reclamo(acciones: string[], extra: Partial<ReclamoBaseMl> = {}): ReclamoBaseMl {
  return {
    id: "5619539113", tipo: "mediations", etapa: "claim", estado: "opened", motivoId: "PDD9939", recurso: "order", recursoId: "2000", siteId: "MCO", fecha: null, actualizado: null,
    jugadores: [{ rol: "respondent", tipo: "seller", userId: "7", acciones: acciones.map((accion) => ({ accion, vence: null, obligatoria: false })) }],
    ...extra,
  };
}
const OFERTAS = { moneda: "COP", ofertas: [{ porcentaje: 25, monto: 1000 }, { porcentaje: 50, monto: 2000 }] };

describe("reclamosResolucion", () => {
  beforeEach(() => {
    escribir.mockReset();
    escribir.mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
  });

  it("parsea available-offers y descarta lo que no reconoce", () => {
    const r = leerOfertasReembolsoParcialMl({ currency_id: "COP", available_offers: [{ percentage: 50, amount: 2000 }, { percentage: 25, amount: "1000" }, { percentage: 0 }, { x: 1 }, { percentage: 50 }] });
    expect(r).toEqual({ moneda: "COP", ofertas: [{ porcentaje: 25, monto: 1000 }, { porcentaje: 50, monto: 2000 }] });
    expect(leerOfertasReembolsoParcialMl(null).ofertas).toEqual([]);
  });

  it("el porcentaje va con un decimal", () => {
    expect(valorPorcentaje(50)).toBe("50.0");
  });

  it("reembolso parcial: manda el cuerpo documentado con un porcentaje de las ofertas", async () => {
    const r = await ofrecerReembolsoParcialMl(reclamo(["allow_partial_refund"]), 50, OFERTAS, "tok");
    expect(r.ok).toBe(true);
    expect(escribir).toHaveBeenCalledTimes(1);
    expect(escribir.mock.calls[0][0]).toContain("/post-purchase/v1/claims/5619539113/expected_resolutions");
    expect(escribir.mock.calls[0][3]).toEqual({ expected_resolution: "allow_partial_refund", detail: { key: "percentage", value: "50.0" } });
  });

  it("reembolso parcial: un porcentaje que no está en las ofertas no llama a ML", async () => {
    const r = await ofrecerReembolsoParcialMl(reclamo(["allow_partial_refund"]), 60, OFERTAS, "tok");
    expect(r.llamado).toBe(false);
    expect(escribir).not.toHaveBeenCalled();
  });

  it("sin la acción disponible, reclamo cerrado o no PDD: no llama a ML", async () => {
    expect((await ofrecerReembolsoParcialMl(reclamo([]), 50, OFERTAS, "t")).llamado).toBe(false);
    expect((await ofrecerReembolsoParcialMl(reclamo(["allow_partial_refund"], { estado: "closed" }), 50, OFERTAS, "t")).llamado).toBe(false);
    expect((await ofrecerReembolsoParcialMl(reclamo(["allow_partial_refund"], { motivoId: "PNR1" }), 50, OFERTAS, "t")).llamado).toBe(false);
    expect((await reembolsoTotalMl(reclamo(["open_dispute"]), "t")).llamado).toBe(false);
    expect((await ofrecerDevolucionMl(reclamo(["refund"]), "t")).llamado).toBe(false);
    expect((await pedirMediacionMl(reclamo(["refund"]), "t")).llamado).toBe(false);
    expect(escribir).not.toHaveBeenCalled();
  });

  it("reembolso total, devolución y mediación usan los endpoints documentados", async () => {
    await reembolsoTotalMl(reclamo(["refund"]), "t");
    await ofrecerDevolucionMl(reclamo(["allow_return"]), "t");
    await pedirMediacionMl(reclamo(["open_dispute"]), "t");
    expect(escribir.mock.calls[0][0]).toContain("/claims/5619539113/expected-resolutions/refund");
    expect(escribir.mock.calls[1][3]).toEqual({ expected_resolution: "return_product" });
    expect(escribir.mock.calls[2][2]).toBe("PUT");
    expect(escribir.mock.calls[2][3]).toEqual({ stage: "dispute" });
  });
});
