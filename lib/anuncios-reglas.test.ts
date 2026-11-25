import { describe, expect, it } from "vitest";
import { estadoAnuncio, fechaColombia, validarAnuncio } from "./anuncios-reglas";

const ahora = new Date("2026-11-25T20:00:00Z"); // 15:00 en Colombia
const base = { mensaje: "Mercado Libre tiene fallas", tipo: "advertencia", desde: "", hasta: "" };

describe("fechaColombia", () => {
  it("interpreta la hora del formulario como hora de Colombia (UTC-5)", () => {
    expect((fechaColombia("2026-11-25T14:30") as Date).toISOString()).toBe("2026-11-25T19:30:00.000Z");
    expect(fechaColombia("")).toBeNull();
    expect(fechaColombia("mañana")).toBe("invalida");
  });
});

describe("validarAnuncio", () => {
  it("sin «desde» empieza ahora; «hasta» es opcional", () => {
    const r = validarAnuncio(base, ahora);
    expect(r).toMatchObject({ ok: true, anuncio: { mensaje: "Mercado Libre tiene fallas", tipo: "advertencia", inicioTs: ahora, finTs: null } });
  });

  it("limpia espacios y rechaza vacío, largo o tipo desconocido", () => {
    expect(validarAnuncio({ ...base, mensaje: "  a   b  " }, ahora)).toMatchObject({ ok: true, anuncio: { mensaje: "a b" } });
    expect(validarAnuncio({ ...base, mensaje: "   " }, ahora)).toMatchObject({ ok: false });
    expect(validarAnuncio({ ...base, mensaje: "x".repeat(301) }, ahora)).toMatchObject({ ok: false });
    expect(validarAnuncio({ ...base, tipo: "toString" }, ahora)).toMatchObject({ ok: false });
  });

  it("«hasta» debe ser después de «desde» y no estar en el pasado", () => {
    expect(validarAnuncio({ ...base, desde: "2026-11-26T10:00", hasta: "2026-11-26T09:00" }, ahora)).toMatchObject({ ok: false });
    expect(validarAnuncio({ ...base, desde: "2026-11-20T10:00", hasta: "2026-11-24T10:00" }, ahora)).toMatchObject({ ok: false });
    expect(validarAnuncio({ ...base, desde: "2026-11-26T10:00", hasta: "2026-11-27T10:00" }, ahora)).toMatchObject({ ok: true });
  });
});

describe("estadoAnuncio", () => {
  const a = (inicio: string, fin: string | null, retirado: string | null = null) => ({ inicioTs: new Date(inicio), finTs: fin ? new Date(fin) : null, retiradoTs: retirado ? new Date(retirado) : null });
  it("programado, activo, vencido y retirado", () => {
    expect(estadoAnuncio(a("2026-11-26T00:00:00Z", null), ahora)).toBe("programado");
    expect(estadoAnuncio(a("2026-11-25T00:00:00Z", null), ahora)).toBe("activo");
    expect(estadoAnuncio(a("2026-11-25T00:00:00Z", "2026-11-25T19:00:00Z"), ahora)).toBe("vencido");
    expect(estadoAnuncio(a("2026-11-25T00:00:00Z", null, "2026-11-25T10:00:00Z"), ahora)).toBe("retirado");
  });
});
