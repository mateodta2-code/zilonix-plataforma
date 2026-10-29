import { existsSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// subirClipMultiCuenta.ts importa lib/ml/cuentas.ts (obtenerAccessTokenVigente)
// Y lib/ml/clip.ts, que TAMBIÉN importa lib/ml/cuentas.ts — ese archivo
// importa db/empresa-context.ts, que exige DATABASE_URL_APP solo con
// cargarse (igual que el resto del repo que toca Postgres). Se mockea
// ANTES de cualquier import real, para poder probar la orquestación
// del trabajo (el pool de concurrencia, el progreso, la limpieza del
// archivo temporal) sin Postgres real y sin tocar Mercado Libre.
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn().mockResolvedValue("token-fake") }));

// vi.mock() se hoistea arriba de TODO el archivo (incluso arriba de un
// `const` normal) — vi.hoisted() es la forma real de compartir un mock
// entre el factory de vi.mock y el resto del archivo sin pisar ese
// orden.
const { subirClipItemDesdeArchivoMock } = vi.hoisted(() => ({ subirClipItemDesdeArchivoMock: vi.fn() }));
vi.mock("@/lib/ml/clip", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/clip")>();
  return { ...real, subirClipItemDesdeArchivo: subirClipItemDesdeArchivoMock };
});

import { ClipReputacionRequeridaError } from "@/lib/ml/clip";
import { iniciarTrabajoClip, obtenerTrabajoClip, type CuentaParaSubirClip } from "./subirClipMultiCuenta";

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Espera (con un tope real) a que el trabajo termine — nunca un
// `sleep` fijo adivinado: sondea `terminadoTs` cada pocos ms.
async function esperarTrabajoTerminado(jobId: string, empresaId: string, maxEsperaMs = 2000): Promise<ReturnType<typeof obtenerTrabajoClip>> {
  const inicio = Date.now();
  while (Date.now() - inicio < maxEsperaMs) {
    const trabajo = obtenerTrabajoClip(jobId, empresaId);
    if (trabajo?.terminadoTs != null) return trabajo;
    await esperar(5);
  }
  throw new Error("El trabajo no terminó a tiempo.");
}

function archivoTemporalDePrueba(): string {
  const carpeta = mkdtempSync(path.join(tmpdir(), "zilonix-clip-job-test-"));
  const ruta = path.join(carpeta, "video.mp4");
  writeFileSync(ruta, "contenido de prueba");
  return ruta;
}

describe("iniciarTrabajoClip/obtenerTrabajoClip — rama feat-publicar-clip, punto 4 (subida multi-cuenta)", () => {
  afterEach(() => {
    subirClipItemDesdeArchivoMock.mockReset();
  });

  it("sube a varias cuentas, cada una termina en_moderacion con su propio clipUuid", async () => {
    const empresaId = "empresa-1";
    const rutaArchivo = archivoTemporalDePrueba();
    subirClipItemDesdeArchivoMock.mockImplementation(async (_token: string, itemId: string) => ({
      status: "accepted",
      clipUuid: `uuid-${itemId}`,
      siteIds: ["MCO"],
    }));
    const cuentas: CuentaParaSubirClip[] = [
      { cuentaId: "c1", nickname: "Cuenta 1", itemId: "MCO1" },
      { cuentaId: "c2", nickname: "Cuenta 2", itemId: "MCO2" },
      { cuentaId: "c3", nickname: "Cuenta 3", itemId: "MCO3" },
    ];
    const jobId = iniciarTrabajoClip(empresaId, cuentas, rutaArchivo, "video/mp4");
    const trabajo = await esperarTrabajoTerminado(jobId, empresaId);
    expect(trabajo?.cuentas.every((c) => c.estado === "en_moderacion")).toBe(true);
    expect(trabajo?.cuentas.map((c) => c.clipUuid)).toEqual(["uuid-MCO1", "uuid-MCO2", "uuid-MCO3"]);
    // El archivo temporal compartido se borra al terminar el trabajo entero.
    expect(existsSync(rutaArchivo)).toBe(false);
  });

  it("una cuenta falla (reputación requerida), las demás siguen y terminan bien — fallas parciales", async () => {
    const empresaId = "empresa-2";
    const rutaArchivo = archivoTemporalDePrueba();
    subirClipItemDesdeArchivoMock.mockImplementation(async (_token: string, itemId: string) => {
      if (itemId === "MCO2") throw new ClipReputacionRequeridaError("Mercado Libre no deja subir Clips en esta cuenta todavía — necesita reputación.");
      return { status: "accepted", clipUuid: `uuid-${itemId}`, siteIds: ["MCO"] };
    });
    const cuentas: CuentaParaSubirClip[] = [
      { cuentaId: "c1", nickname: "Cuenta 1", itemId: "MCO1" },
      { cuentaId: "c2", nickname: "Cuenta 2", itemId: "MCO2" },
      { cuentaId: "c3", nickname: "Cuenta 3", itemId: "MCO3" },
    ];
    const jobId = iniciarTrabajoClip(empresaId, cuentas, rutaArchivo, "video/mp4");
    const trabajo = await esperarTrabajoTerminado(jobId, empresaId);
    const filaC1 = trabajo?.cuentas.find((c) => c.cuentaId === "c1");
    const filaC2 = trabajo?.cuentas.find((c) => c.cuentaId === "c2");
    const filaC3 = trabajo?.cuentas.find((c) => c.cuentaId === "c3");
    expect(filaC1?.estado).toBe("en_moderacion");
    expect(filaC2?.estado).toBe("error");
    expect(filaC2?.error).toContain("reputación");
    expect(filaC3?.estado).toBe("en_moderacion");
    // El archivo se borra igual al final, aunque una cuenta haya fallado.
    expect(existsSync(rutaArchivo)).toBe(false);
  });

  it("una cuenta trae su PROPIO video distinto ('usar otro video para esta cuenta'): ese archivo también se borra al final", async () => {
    const empresaId = "empresa-3";
    const rutaCompartida = archivoTemporalDePrueba();
    const rutaPropia = archivoTemporalDePrueba();
    subirClipItemDesdeArchivoMock.mockResolvedValue({ status: "accepted", clipUuid: "uuid-x", siteIds: ["MCO"] });
    const cuentas: CuentaParaSubirClip[] = [
      { cuentaId: "c1", nickname: "Cuenta 1", itemId: "MCO1" },
      { cuentaId: "c2", nickname: "Cuenta 2", itemId: "MCO2", rutaArchivo: rutaPropia, contentType: "video/quicktime" },
    ];
    const jobId = iniciarTrabajoClip(empresaId, cuentas, rutaCompartida, "video/mp4");
    await esperarTrabajoTerminado(jobId, empresaId);
    expect(existsSync(rutaCompartida)).toBe(false);
    expect(existsSync(rutaPropia)).toBe(false);
    // La cuenta con video propio usó SU ruta y SU content-type, no el default.
    const llamadaC2 = subirClipItemDesdeArchivoMock.mock.calls.find((args) => args[1] === "MCO2");
    expect(llamadaC2?.[2]).toBe(rutaPropia);
    expect(llamadaC2?.[4]).toBe("video/quicktime");
  });

  it("devuelve el id del trabajo de inmediato (nunca espera a que termine la subida)", () => {
    const rutaArchivo = archivoTemporalDePrueba();
    subirClipItemDesdeArchivoMock.mockImplementation(async () => {
      await esperar(500);
      return { status: "accepted", clipUuid: "uuid-x", siteIds: ["MCO"] };
    });
    const antes = Date.now();
    const jobId = iniciarTrabajoClip("empresa-4", [{ cuentaId: "c1", nickname: "Cuenta 1", itemId: "MCO1" }], rutaArchivo, "video/mp4");
    expect(Date.now() - antes).toBeLessThan(100);
    expect(typeof jobId).toBe("string");
    expect(jobId.length).toBeGreaterThan(0);
  });

  it("RLS a mano — un trabajo nunca se devuelve para una empresa distinta a la que lo creó", async () => {
    const rutaArchivo = archivoTemporalDePrueba();
    subirClipItemDesdeArchivoMock.mockResolvedValue({ status: "accepted", clipUuid: "uuid-x", siteIds: ["MCO"] });
    const jobId = iniciarTrabajoClip("empresa-dueña", [{ cuentaId: "c1", nickname: "Cuenta 1", itemId: "MCO1" }], rutaArchivo, "video/mp4");
    expect(obtenerTrabajoClip(jobId, "empresa-ajena")).toBeNull();
    await esperarTrabajoTerminado(jobId, "empresa-dueña");
  });

  it("un jobId inexistente: null, nunca lanza", () => {
    expect(obtenerTrabajoClip("no-existe", "empresa-1")).toBeNull();
  });
});
