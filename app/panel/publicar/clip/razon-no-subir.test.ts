import { describe, expect, it } from "vitest";
import {
  advertenciaNoPuedeSubirClip,
  MENSAJE_CODEC_NO_LEGIBLE_CLIP,
  MENSAJE_LEYENDO_VIDEO_CLIP,
  MENSAJE_SIN_CUENTAS_CLIP,
  MENSAJE_SIN_VIDEO_CLIP,
  razonesNoPuedeSubirClip,
  type EntradaRazonNoSubirClip,
} from "./razon-no-subir";

const BASE: EntradaRazonNoSubirClip = {
  tieneVideo: true,
  tamanoBytes: 50 * 1024 * 1024,
  metadatos: { duracionSegundos: 30, ancho: 400, alto: 700, tamanoBytes: 50 * 1024 * 1024 },
  errorCodec: false,
  hayCuentaMarcada: true,
  subiendo: false,
};

describe("razonesNoPuedeSubirClip — Alcance B, caso real: botón apagado sin aviso", () => {
  it("todo OK -> sin razones, se puede subir", () => {
    expect(razonesNoPuedeSubirClip(BASE)).toEqual([]);
  });

  it("subiendo -> sin razones (el botón ya dice 'Subiendo…')", () => {
    expect(razonesNoPuedeSubirClip({ ...BASE, subiendo: true, tieneVideo: false })).toEqual([]);
  });

  it("sin video elegido -> razón explícita", () => {
    expect(razonesNoPuedeSubirClip({ ...BASE, tieneVideo: false, tamanoBytes: null, metadatos: null })).toEqual([MENSAJE_SIN_VIDEO_CLIP]);
  });

  it("video elegido pero sin metadatos todavía (ni error de códec) -> 'Leyendo el video…'", () => {
    expect(razonesNoPuedeSubirClip({ ...BASE, metadatos: null })).toEqual([MENSAJE_LEYENDO_VIDEO_CLIP]);
  });

  it("caso real de staging (MP4 de Débora, 11MB): códec ilegible ya NO bloquea — sin metadatos, se puede subir igual", () => {
    expect(razonesNoPuedeSubirClip({ ...BASE, metadatos: null, errorCodec: true })).toEqual([]);
  });

  it("códec ilegible sin ninguna cuenta marcada -> sigue bloqueando por falta de cuenta, no por el códec", () => {
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: null, errorCodec: true, hayCuentaMarcada: false });
    expect(r).toEqual([MENSAJE_SIN_CUENTAS_CLIP]);
  });

  it("códec ilegible + 281MB: el tamaño SIGUE bloqueando (no depende de leer metadatos)", () => {
    const tamano = 280 * 1024 * 1024 + 1;
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: null, errorCodec: true, tamanoBytes: tamano });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/281 MB/);
  });

  it("advertenciaNoPuedeSubirClip: aviso informativo solo cuando hay error de códec y nunca llegaron metadatos", () => {
    expect(advertenciaNoPuedeSubirClip({ errorCodec: true, metadatos: null })).toBe(MENSAJE_CODEC_NO_LEGIBLE_CLIP);
    expect(advertenciaNoPuedeSubirClip({ errorCodec: false, metadatos: null })).toBeNull();
    expect(advertenciaNoPuedeSubirClip({ errorCodec: true, metadatos: BASE.metadatos })).toBeNull();
  });

  it("video de más de 280MB, SIN esperar metadatos: avisa con el tamaño real en MB", () => {
    const tamano = 300 * 1024 * 1024;
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: null, tamanoBytes: tamano });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/300 MB/);
    expect(r[0]).toMatch(/280 MB/);
  });

  it("exactamente 280MB: permitido (el límite es estrictamente MAYOR a 280MB)", () => {
    const tamano = 280 * 1024 * 1024;
    expect(razonesNoPuedeSubirClip({ ...BASE, tamanoBytes: tamano, metadatos: { ...BASE.metadatos!, tamanoBytes: tamano } })).toEqual([]);
  });

  it("280MB + 1 byte: demasiado_grande con el MB real (281, redondeado hacia arriba)", () => {
    const tamano = 280 * 1024 * 1024 + 1;
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: null, tamanoBytes: tamano });
    expect(r[0]).toMatch(/281 MB/);
  });

  it("duración fuera de rango con metadatos: valor real + requisito", () => {
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: { ...BASE.metadatos!, duracionSegundos: 5 } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/5 s/);
    expect(r[0]).toMatch(/10 y 61/);
  });

  it("metadatos SÍ se leyeron (5s de duración): sigue bloqueando aunque errorCodec quedara en true antes de resolver", () => {
    const r = razonesNoPuedeSubirClip({ ...BASE, errorCodec: true, metadatos: { ...BASE.metadatos!, duracionSegundos: 5 } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/5 s/);
  });

  it("no vertical con metadatos: valor real (AxB) + requisito", () => {
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: { ...BASE.metadatos!, ancho: 700, alto: 680 } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/700×680/);
  });

  it("resolución baja con metadatos: valor real + mínimo 360×640", () => {
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: { ...BASE.metadatos!, ancho: 200, alto: 350 } });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/200×350/);
    expect(r[0]).toMatch(/360×640/);
  });

  it("varios problemas de metadatos a la vez: TODOS, nunca solo el primero", () => {
    // duracion_corta (5s) + no_vertical (400 <= 700) + resolucion_baja (alto 400 < 640)
    const r = razonesNoPuedeSubirClip({ ...BASE, metadatos: { duracionSegundos: 5, ancho: 700, alto: 400, tamanoBytes: 50 * 1024 * 1024 } });
    expect(r).toHaveLength(3);
  });

  it("todo OK con metadatos pero ninguna cuenta marcada -> razón explícita", () => {
    expect(razonesNoPuedeSubirClip({ ...BASE, hayCuentaMarcada: false })).toEqual([MENSAJE_SIN_CUENTAS_CLIP]);
  });
});
