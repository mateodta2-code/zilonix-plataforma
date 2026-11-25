import { beforeEach, describe, expect, it, vi } from "vitest";

const escribir = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ml/cliente", async () => {
  const real = await vi.importActual<typeof import("@/lib/ml/cliente")>("@/lib/ml/cliente");
  return { ...real, escribirMl: escribir };
});

import type { ReclamoBaseMl } from "@/lib/ml/reclamos";
import { leerMotivosFallaDevolucionMl, revisarDevolucionMl } from "./devolucionesRevision";

function reclamo(acciones: string[], estado = "opened"): ReclamoBaseMl {
  return {
    id: "55", tipo: null, etapa: null, estado, motivoId: null, recurso: "order", recursoId: "2000", siteId: null, fecha: null, actualizado: null,
    jugadores: [{ rol: "respondent", tipo: null, userId: "7", acciones: acciones.map((accion) => ({ accion, vence: null, obligatoria: false })) }],
  };
}
const MOTIVOS = [{ id: "SRF2", nombre: "Dañado" }];

describe("revisarDevolucionMl", () => {
  beforeEach(() => {
    escribir.mockReset();
    escribir.mockResolvedValue({ ok: true, status: 200, data: {}, textoCrudo: "" });
  });

  it("parsea los motivos", () => {
    expect(leerMotivosFallaDevolucionMl([{ id: "SRF2", name: "Dañado" }, { id: "x y" }])).toEqual(MOTIVOS);
  });

  it("llegó bien: llama solo si la acción está disponible", async () => {
    expect((await revisarDevolucionMl(reclamo([]), { resultado: "ok", devolucionId: "9", ordenId: "2000" }, [], "t")).llamado).toBe(false);
    expect((await revisarDevolucionMl(reclamo(["return_review_ok"], "closed"), { resultado: "ok", devolucionId: "9", ordenId: "2000" }, [], "t")).llamado).toBe(false);
    expect(escribir).not.toHaveBeenCalled();
    const r = await revisarDevolucionMl(reclamo(["return_review_ok"]), { resultado: "ok", devolucionId: "9", ordenId: "2000" }, [], "t");
    expect(r.ok).toBe(true);
    expect(escribir.mock.calls[0][0]).toContain("/post-purchase/v1/returns/9/return-review");
  });

  it("con falla: exige un motivo que ML ofreció y un mensaje", async () => {
    const rec = reclamo(["return_review_fail"]);
    const base = { resultado: "con_falla" as const, devolucionId: "9", ordenId: null };
    expect((await revisarDevolucionMl(rec, { ...base, motivoId: "OTRO", mensaje: "roto" }, MOTIVOS, "t")).llamado).toBe(false);
    expect((await revisarDevolucionMl(rec, { ...base, motivoId: "SRF2", mensaje: " " }, MOTIVOS, "t")).llamado).toBe(false);
    expect(escribir).not.toHaveBeenCalled();
    expect((await revisarDevolucionMl(rec, { ...base, motivoId: "SRF2", mensaje: "roto" }, MOTIVOS, "t")).ok).toBe(true);
  });
});
