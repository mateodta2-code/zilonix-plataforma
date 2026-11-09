import { describe, expect, it } from "vitest";
import {
  DURACION_FASE_RAPIDA_MODERACION_MS,
  etiquetaModeracionClip,
  INTERVALO_ESPACIADO_MODERACION_MS,
  INTERVALO_RAPIDO_MODERACION_MS,
  proximoIntervaloModeracionMs,
  sigueConsultandoModeracion,
  TOPE_POLLING_MODERACION_MS,
} from "./estado-moderacion";

describe("etiquetaModeracionClip — Alcance A, mapa de etiquetas", () => {
  it("UNDER_REVIEW -> En revisión por Mercado Libre", () => {
    expect(etiquetaModeracionClip("UNDER_REVIEW", null)).toEqual({ texto: "En revisión por Mercado Libre", estado: "aviso" });
  });

  it("PUBLISHED -> Publicado", () => {
    expect(etiquetaModeracionClip("PUBLISHED", null)).toEqual({ texto: "Publicado", estado: "exito" });
  });

  it("REJECTED sin motivo -> Rechazado", () => {
    expect(etiquetaModeracionClip("REJECTED", null)).toEqual({ texto: "Rechazado", estado: "peligro" });
  });

  it("REJECTED con motivo -> incluye el motivo real", () => {
    expect(etiquetaModeracionClip("REJECTED", "Audio de mala calidad")).toEqual({ texto: "Rechazado: Audio de mala calidad", estado: "peligro" });
  });

  it("null (la API todavía no devolvió clips) -> texto neutro de espera, NUNCA Publicado", () => {
    const r = etiquetaModeracionClip(null, null);
    expect(r.texto).not.toMatch(/publicado/i);
    expect(r.estado).toBe("neutro");
  });

  it("un moderation_status desconocido (campo nuevo de Mercado Libre) -> texto neutro, NUNCA Publicado", () => {
    const r = etiquetaModeracionClip("ALGO_NUEVO_QUE_ML_AGREGUE", null);
    expect(r.texto).not.toMatch(/publicado/i);
    expect(r.texto).not.toBe("ALGO_NUEVO_QUE_ML_AGREGUE");
  });
});

describe("sigueConsultandoModeracion — cuándo parar de consultar una cuenta", () => {
  it("PUBLISHED -> para", () => {
    expect(sigueConsultandoModeracion("PUBLISHED")).toBe(false);
  });
  it("REJECTED -> para", () => {
    expect(sigueConsultandoModeracion("REJECTED")).toBe(false);
  });
  it("UNDER_REVIEW -> sigue", () => {
    expect(sigueConsultandoModeracion("UNDER_REVIEW")).toBe(true);
  });
  it("null (sin clips todavía) -> sigue", () => {
    expect(sigueConsultandoModeracion(null)).toBe(true);
  });
  it("un valor desconocido -> sigue (nunca se para por un campo que no se reconoce)", () => {
    expect(sigueConsultandoModeracion("ALGO_NUEVO")).toBe(true);
  });
});

describe("proximoIntervaloModeracionMs — ritmo de polling (60s -> 3min -> tope 48h)", () => {
  it("recién entrando en moderación (0ms) -> intervalo rápido", () => {
    expect(proximoIntervaloModeracionMs(0)).toBe(INTERVALO_RAPIDO_MODERACION_MS);
  });

  it("justo antes de que termine la fase rápida -> sigue rápido", () => {
    expect(proximoIntervaloModeracionMs(DURACION_FASE_RAPIDA_MODERACION_MS - 1)).toBe(INTERVALO_RAPIDO_MODERACION_MS);
  });

  it("justo al terminar la fase rápida -> pasa a espaciado", () => {
    expect(proximoIntervaloModeracionMs(DURACION_FASE_RAPIDA_MODERACION_MS)).toBe(INTERVALO_ESPACIADO_MODERACION_MS);
  });

  it("bien avanzado, dentro del tope -> espaciado", () => {
    expect(proximoIntervaloModeracionMs(TOPE_POLLING_MODERACION_MS - 1)).toBe(INTERVALO_ESPACIADO_MODERACION_MS);
  });

  it("al llegar al tope (48h) -> null, deja de consultar", () => {
    expect(proximoIntervaloModeracionMs(TOPE_POLLING_MODERACION_MS)).toBeNull();
  });

  it("pasado el tope -> sigue null", () => {
    expect(proximoIntervaloModeracionMs(TOPE_POLLING_MODERACION_MS + 60_000)).toBeNull();
  });
});
