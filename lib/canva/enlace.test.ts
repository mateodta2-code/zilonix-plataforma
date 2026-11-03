import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import { EnlaceCanvaInvalidoError, EnlaceCanvaNoDisponibleError, EnlaceCanvaNoPermitidoError, EnlaceCanvaSinDesignIdError, resolverDesignId } from "./enlace";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

function respuestaRedirect(location: string) {
  return { status: 302, headers: { get: (k: string) => (k.toLowerCase() === "location" ? location : null) } } as unknown as Response;
}

function respuestaFinal(status = 200) {
  return { status, headers: { get: () => null } } as unknown as Response;
}

describe("resolverDesignId — link largo (canva.com/design/<id>/...)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("extrae el design_id directo de la URL, sin ninguna llamada a fetch ni a DNS", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const designId = await resolverDesignId("https://www.canva.com/design/DAFxyz123_abc/edit");

    expect(designId).toBe("DAFxyz123_abc");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("sin ningún ID con el prefijo DA en la URL: EnlaceCanvaSinDesignIdError", async () => {
    await expect(resolverDesignId("https://www.canva.com/design/sin-id-real")).rejects.toThrow(EnlaceCanvaSinDesignIdError);
  });
});

describe("resolverDesignId — link corto (canva.link/...), sigue la redirección real con defensas anti-SSRF", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    lookupMock.mockReset();
  });

  it("sigue la redirección hasta canva.com y extrae el design_id", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]); // IP pública de prueba
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaRedirect("https://www.canva.com/design/DAGabc999/edit"))
      // El salto de canva.link ya resolvió a canva.com — esta segunda
      // llamada es el GET real a esa URL de canva.com, que ya NO
      // redirige más (200): recién ahí se extrae el design_id.
      .mockResolvedValueOnce(respuestaFinal(200));
    vi.stubGlobal("fetch", fetchMock);

    const designId = await resolverDesignId("https://canva.link/AbCdEf");

    expect(designId).toBe("DAGabc999");
    expect(lookupMock).toHaveBeenCalledWith("canva.link", { all: true });
  });

  it("si la redirección apunta a un host que NO es canva.com, se rechaza (anti-SSRF, nunca sigue a cualquier lado)", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]);
    const fetchMock = vi.fn().mockResolvedValueOnce(respuestaRedirect("https://atacante.ejemplo.com/robar"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolverDesignId("https://canva.link/AbCdEf")).rejects.toThrow(EnlaceCanvaNoPermitidoError);
  });

  it("si el DNS del link corto resuelve a una IP privada, se rechaza ANTES de llamar a fetch", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254" }]); // IP de metadata de nube
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolverDesignId("https://canva.link/AbCdEf")).rejects.toThrow(EnlaceCanvaNoPermitidoError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("demasiadas redirecciones encadenadas: EnlaceCanvaNoDisponibleError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]);
    const fetchMock = vi.fn().mockImplementation(async () => respuestaRedirect("https://canva.com/design/DAsiguesaltando/edit-pero-redirige-otra-vez"));
    // Cada hop redirige a OTRA url de canva.com (nunca termina) — el
    // regex DA.* matchearía la URL misma, pero el código solo lo revisa
    // cuando YA no hay más redirección (status final), así que esto
    // debe agotar MAX_SALTOS.
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolverDesignId("https://canva.link/loop")).rejects.toThrow(EnlaceCanvaNoDisponibleError);
  });

  it("si la URL final (sin más redirect) no tiene design_id: EnlaceCanvaSinDesignIdError", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.140" }]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuestaRedirect("https://www.canva.com/sin-ningun-id"))
      .mockResolvedValueOnce(respuestaFinal(200));
    vi.stubGlobal("fetch", fetchMock);

    await expect(resolverDesignId("https://canva.link/AbCdEf")).rejects.toThrow(EnlaceCanvaSinDesignIdError);
  });
});

describe("resolverDesignId — validaciones de entrada", () => {
  it("rechaza una URL inválida", async () => {
    await expect(resolverDesignId("no-es-una-url")).rejects.toThrow(EnlaceCanvaInvalidoError);
  });

  it("rechaza un link http (no https)", async () => {
    await expect(resolverDesignId("http://canva.com/design/DAxyz/edit")).rejects.toThrow(EnlaceCanvaInvalidoError);
  });

  it("rechaza cualquier host que no sea canva.com ni canva.link", async () => {
    await expect(resolverDesignId("https://atacante.ejemplo.com/design/DAxyz/edit")).rejects.toThrow(EnlaceCanvaNoPermitidoError);
  });
});
