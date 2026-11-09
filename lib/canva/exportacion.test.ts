import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// lib/cloudinary.ts importa "server-only" en su primera línea (mismo
// motivo que lib/cloudinary.test.ts) — sin este mock, vitest revienta
// con "This module cannot be imported from a Client Component module".
vi.mock("server-only", () => ({}));
// descargarPaginaSegura usa exigirHostnamePublico (lib/seguridad/ssrf.ts),
// que hace un lookup de DNS real — mismo mock que validar-url-externa.test.ts.
vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import {
  ExportacionCanvaDemoradaError,
  ExportacionCanvaFallidaError,
  ExportacionCanvaSinAccesoError,
  ExportacionCanvaUrlNoPermitidaError,
  exportarDisenoPng,
  subirPaginasACloudinary,
} from "./exportacion";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

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
    lookupMock.mockReset();
  });

  it("descarga las páginas y las sube a Cloudinary, devolviendo las URLs de Cloudinary", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "cloud-de-prueba";
    process.env.CLOUDINARY_API_KEY = "key-de-prueba";
    process.env.CLOUDINARY_API_SECRET = "secret-de-prueba";
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]); // IP pública de prueba

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("cloudinary.com")) {
        return respuestaJson({ secure_url: "https://res.cloudinary.com/cloud-de-prueba/image/upload/canva.png" });
      }
      return respuestaImagenPng();
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = await subirPaginasACloudinary(["https://media.canva.com/v2/export/pagina1.png"]);

    expect(urls).toEqual(["https://res.cloudinary.com/cloud-de-prueba/image/upload/canva.png"]);
    const [, opcionesDescarga] = fetchMock.mock.calls[0];
    expect(opcionesDescarga?.redirect).toBe("error");
  });

  // Ajuste del review (PR #368) — mismo motivo que validar-url-externa.ts:
  // un redirect podría mandar a un host/IP distinto del que ya se
  // validó contra la allowlist + DNS; con redirect:"error", fetch
  // rechaza la promesa en vez de seguirlo a ciegas.
  it("si la página exportada redirige, se rechaza en vez de seguir la redirección", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]);
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError("Failed to fetch — redirect prohibido"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(subirPaginasACloudinary(["https://media.canva.com/v2/export/pagina1.png"])).rejects.toThrow();
  });

  it("si la descarga de una página falla, no llega a subir nada a Cloudinary", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]);
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 502 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    await expect(subirPaginasACloudinary(["https://media.canva.com/v2/export/pagina-rota.png"])).rejects.toThrow();
  });

  // Issue #366 — caso feliz real: Canva Connect devuelve la URL de
  // descarga en export-download.canva.com (no en media.canva.com).
  it("descarga una página servida en export-download.canva.com y la sube a Cloudinary", async () => {
    process.env.CLOUDINARY_CLOUD_NAME = "cloud-de-prueba";
    process.env.CLOUDINARY_API_KEY = "key-de-prueba";
    process.env.CLOUDINARY_API_SECRET = "secret-de-prueba";
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]);

    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("cloudinary.com")) {
        return respuestaJson({ secure_url: "https://res.cloudinary.com/cloud-de-prueba/image/upload/canva.png" });
      }
      return respuestaImagenPng();
    });
    vi.stubGlobal("fetch", fetchMock);

    const urls = await subirPaginasACloudinary(["https://export-download.canva.com/v2/export/pagina1.png"]);

    expect(urls).toEqual(["https://res.cloudinary.com/cloud-de-prueba/image/upload/canva.png"]);
  });

  // Hallazgo del review (PR #368) — las URLs las manda la respuesta de
  // la API de Canva; si alguna viniera fuera de la allowlist de Canva
  // (bug o respuesta comprometida), nunca se descarga a ciegas.
  it("rechaza una URL de exportación fuera de la allowlist de Canva, sin llegar a pedirla", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(subirPaginasACloudinary(["https://atacante.ejemplo.com/pagina.png"])).rejects.toThrow(ExportacionCanvaUrlNoPermitidaError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rechaza una URL de exportación que resuelve a una IP privada", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(subirPaginasACloudinary(["https://media.canva.com/v2/export/pagina1.png"])).rejects.toThrow(ExportacionCanvaUrlNoPermitidaError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
