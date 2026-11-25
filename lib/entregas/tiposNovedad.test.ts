import { describe, expect, it } from "vitest";
import { validarNovedad } from "./tiposNovedad";

describe("validarNovedad (Domi-4)", () => {
  it("tipo conocido, detalle opcional y recortado", () => {
    expect(validarNovedad("voy_tarde", "")).toEqual({ ok: true, tipo: "voy_tarde", detalle: null });
    expect(validarNovedad("reprogramar", "  mañana  ")).toEqual({ ok: true, tipo: "reprogramar", detalle: "mañana" });
    expect(validarNovedad("no_contesta", "x".repeat(300))).toMatchObject({ ok: true, detalle: "x".repeat(200) });
  });

  it("«Otro» exige detalle y un tipo desconocido no pasa", () => {
    expect(validarNovedad("otro", "   ")).toMatchObject({ ok: false });
    expect(validarNovedad("otro", "la moto se varó")).toMatchObject({ ok: true, detalle: "la moto se varó" });
    expect(validarNovedad("inventado", "x")).toMatchObject({ ok: false });
    expect(validarNovedad("toString", "x")).toMatchObject({ ok: false });
  });
});
