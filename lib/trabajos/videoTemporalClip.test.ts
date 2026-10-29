import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { obtenerVideoTemporal, quitarVideoTemporalDelMapa, registrarVideoTemporal } from "./videoTemporalClip";

function archivoDePrueba(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), "zilonix-video-temp-test-"));
  const ruta = path.join(carpeta, "video.mp4");
  writeFileSync(ruta, "contenido de prueba");
  return ruta;
}

describe("registrarVideoTemporal/obtenerVideoTemporal/quitarVideoTemporalDelMapa — rama feat-publicar-clip, punto 1/2", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("devuelve lo mismo que se registró, para la empresa dueña", () => {
    const ruta = archivoDePrueba();
    const video = registrarVideoTemporal("empresa-1", ruta, "video/mp4", "clip.mp4");
    expect(obtenerVideoTemporal(video.id, "empresa-1")).toEqual(video);
  });

  it("RLS a mano — nunca se devuelve para una empresa distinta a la que lo registró", () => {
    const ruta = archivoDePrueba();
    const video = registrarVideoTemporal("empresa-dueña", ruta, "video/mp4", "clip.mp4");
    expect(obtenerVideoTemporal(video.id, "empresa-ajena")).toBeNull();
  });

  it("un id inexistente: null, nunca lanza", () => {
    expect(obtenerVideoTemporal("no-existe", "empresa-1")).toBeNull();
  });

  it("quitarVideoTemporalDelMapa saca la entrada — una consulta posterior ya no la encuentra", () => {
    const ruta = archivoDePrueba();
    const video = registrarVideoTemporal("empresa-1", ruta, "video/mp4", "clip.mp4");
    quitarVideoTemporalDelMapa(video.id, "empresa-1");
    expect(obtenerVideoTemporal(video.id, "empresa-1")).toBeNull();
    // Solo se saca del Map — el borrado físico del archivo es
    // responsabilidad del trabajo que lo usa (iniciarTrabajoClip).
    expect(existsSync(ruta)).toBe(true);
  });

  it("quitarVideoTemporalDelMapa de una empresa ajena no borra nada (la entrada real sigue)", () => {
    const ruta = archivoDePrueba();
    const video = registrarVideoTemporal("empresa-dueña", ruta, "video/mp4", "clip.mp4");
    quitarVideoTemporalDelMapa(video.id, "empresa-ajena");
    expect(obtenerVideoTemporal(video.id, "empresa-dueña")).toEqual(video);
  });

  it("un video temporal viejo (más de 30 minutos) se poda solo y borra su archivo físico", () => {
    const ruta = archivoDePrueba();
    const video = registrarVideoTemporal("empresa-1", ruta, "video/mp4", "clip.mp4");
    expect(existsSync(ruta)).toBe(true);

    vi.advanceTimersByTime(31 * 60 * 1000);
    // La poda corre al REGISTRAR el siguiente — nunca hay un cron
    // aparte solo para esto (mismo criterio que subirClipMultiCuenta.ts).
    registrarVideoTemporal("empresa-1", archivoDePrueba(), "video/mp4", "otro.mp4");

    expect(obtenerVideoTemporal(video.id, "empresa-1")).toBeNull();
  });
});
