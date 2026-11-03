import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/cloudinary.ts importa "server-only" en su primera línea (mismo
// motivo que lib/cloudinary.test.ts) — sin este mock, vitest revienta
// con "This module cannot be imported from a Client Component module".
vi.mock("server-only", () => ({}));

import { ExportacionCanvaDemoradaError, ExportacionCanvaFallidaError, ExportacionCanvaSinAccesoError, exportarDisenoPng, subirPaginasACloudinary } from "./exportacion";

function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

const FIRMA_PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function respuestaImagenPng() {
  const buffer = new Uint8Array(100);
  buffer.set(FIRMA_PNG);
  return { ok: true, status: 200, arrayBuffer: async () => buffer.buffer } as unknown as Response;
}

describe("exportarDisenoPng — crea el job y hace polling hasta terminar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("job success en el primer intento: devuelve las URLs de las páginas", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson({ job: { id: "job-1", status: "in_progress" } })) // crear
      .mockResolvedValueOnce(respuestaJson({ job: { id: "job-1", status: "success", urls: ["https://canva.cdn/pagina1.png", "https://canva.cdn/pagina2.png"] } })); // consultar
    vi.stubGlobal("fetch", fetchMock);

    const promesa = exportarDisenoPng("access-token", "DAxyz");
    await vi.runAllTimersAsync();
    const urls = await promesa;

    expect(urls).toEqual(["https://canva.cdn/pagina1.png", "https://canva.cdn/pagina2.png"]);
    const [urlCreate, opcionesCreate] = fetchMock.mock.calls[0];
    expect(urlCreate).toBe("https://api.canva.com/rest/v1/exports");
    expect(JSON.parse(opcionesCreate!.body as string)).toEqual({ design_id: "DAxyz", format: { type: "png" } });
  });

  it("job failed: ExportacionCanvaFallidaError con el mensaje de Canva", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaJson({ job: { id: "job-2", status: "in_progress" } }))
      .mockResolvedValueOnce(respuestaJson({ job: { id: "job-2", status: "failed", error: { message: "diseño corrupto" } } }));
    vi.stubGlobal("fetch", fetchMock);

    const promesa = exportarDisenoPng("access-token", "DAxyz").catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await promesa;
    expect(error).toBeInstanceOf(ExportacionCanvaFallidaError);
    expect((error as Error).message).toBe("diseño corrupto");
  });

  it("nunca termina (siempre in_progress): ExportacionCanvaDemoradaError tras agotar los intentos", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuestaJson({ job: { id: "job-3", status: "in_progress" } }));
    vi.stubGlobal("fetch", fetchMock);

    const promesa = exportarDisenoPng("access-token", "DAxyz").catch((e) => e);
    await vi.runAllTimersAsync();
    const error = await promesa;
    expect(error).toBeInstanceOf(ExportacionCanvaDemoradaError);
  });

  it("403 al crear el export: ExportacionCanvaSinAccesoError (no tiene acceso a ese diseño)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaJson({}, 403));
    vi.stubGlobal("fetch", fetchMock);

    await expect(exportarDisenoPng("access-token", "DAxyz")).rejects.toThrow(ExportacionCanvaSinAccesoError);
  });
});

describe("subirPaginasACloudinary — descarga cada página y la sube con el flujo signed existente", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("descarga las páginas y las sube a Cloudinary, devolviendo las URLs de Cloudinary", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "cloud-de-prueba";
    process.env.CLOUDINARY_API_KEY = "key-de-prueba";
    process.env.CLOUDINARY_API_SECRET = "secret-de-prueba";

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("cloudinary.com")) {
        return respuestaJson({ secure_url: "https://res.cloudinary.com/cloud-de-prueba/image/upload/canva.png" });
      }
      return respuestaImagenPng();
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = await subirPaginasACloudinary(["https://canva.cdn/pagina1.png"]);

    expect(urls).toEqual(["https://res.cloudinary.com/cloud-de-prueba/image/upload/canva.png"]);
  });

  it("si la descarga de una página falla, no llega a subir nada a Cloudinary", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 502 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(subirPaginasACloudinary(["https://canva.cdn/pagina-rota.png"])).rejects.toThrow();
  });
});
