import { describe, expect, it } from "vitest";
import { conReglaYOrigen, nuevoLoteBitacora, resultadoMlOmitida, resumirResultadoMl } from "./promocionesBitacora";

describe("promocionesBitacora (Promo-E)", () => {
  it("conReglaYOrigen agrega lote y extras sin pisar el original", () => {
    const r = conReglaYOrigen({ ok: true, status: 200 }, "maximo", "lote", { lote: "L1", maximoPct: 15, limite: "tope", sku: undefined });
    expect(r).toMatchObject({ ok: true, status: 200, regla: "maximo", origen: "lote", lote: "L1", maximoPct: 15, limite: "tope" });
    expect("sku" in r).toBe(false);
  });

  it("nuevoLoteBitacora genera uuids distintos", () => {
    expect(nuevoLoteBitacora()).not.toBe(nuevoLoteBitacora());
  });

  it("resultadoMlOmitida deja el motivo y nunca llamó a ML", () => {
    expect(resultadoMlOmitida("todas", "lote", "no cumple", { lote: "L" })).toMatchObject({ ok: false, llamoAMercadoLibre: false, motivo: "no cumple", lote: "L" });
  });

  it("resumirResultadoMl expone solo campos conocidos y recortados", () => {
    const d = resumirResultadoMl({ regla: "salir", limite: "raro", motivo: "x".repeat(900), sku: "S".repeat(200), respuesta: "y".repeat(900), token: "SECRETO", maximoPct: 10, lote: "L" });
    expect(d.limite).toBeNull();
    expect(d.motivo).toHaveLength(500);
    expect(d.sku).toHaveLength(80);
    expect(d.respuesta).toHaveLength(500);
    expect(d.maximoPct).toBe(10);
    expect(JSON.stringify(d)).not.toContain("SECRETO");
  });
});
