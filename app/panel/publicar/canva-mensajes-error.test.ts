import { describe, expect, it } from "vitest";
import { mensajeErrorConectarCanva } from "./canva-mensajes-error";

describe("mensajeErrorConectarCanva", () => {
  it("codigo conocido devuelve su mensaje específico", () => {
    expect(mensajeErrorConectarCanva("estado_vencido")).toMatch(/venció/i);
  });

  it("codigo desconocido devuelve el mensaje genérico", () => {
    expect(mensajeErrorConectarCanva("algo_que_no_existe")).toBe("No pudimos conectar con Canva. Intenta de nuevo o escríbenos.");
  });

  // BAJO, review 2 del PR #372 — canva=error sin codigo ya no se queda
  // mudo: el único caller ya filtró canva === "error", así que sin
  // codigo sigue siendo un error real.
  it("sin codigo (canva=error sin codigo) devuelve el mensaje genérico, nunca null", () => {
    expect(mensajeErrorConectarCanva(undefined)).toBe("No pudimos conectar con Canva. Intenta de nuevo o escríbenos.");
  });
});
