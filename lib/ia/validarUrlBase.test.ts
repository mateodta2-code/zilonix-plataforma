import { afterEach, describe, expect, it, vi } from "vitest";

// HIGH 3 (review de Pablo) — mismo patrón de mock que
// lib/ml/video-externo.test.ts: dns/promises mockeado, nunca una
// resolución real en este sandbox ni contra una red externa.
vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import { exigirUrlBaseIASegura, UrlBaseIAInvalidaError } from "./validarUrlBase";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

describe("exigirUrlBaseIASegura — HIGH 3, review de Pablo (SSRF en la baseUrl de 'otro_compatible_openai')", () => {
  afterEach(() => vi.clearAllMocks());

  it("URL inválida: UrlBaseIAInvalidaError, nunca llega a resolver DNS", async () => {
    await expect(exigirUrlBaseIASegura("no-es-una-url")).rejects.toBeInstanceOf(UrlBaseIAInvalidaError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("http (no https): UrlBaseIAInvalidaError, nunca llega a resolver DNS", async () => {
    await expect(exigirUrlBaseIASegura("http://mi-servidor.test/v1")).rejects.toBeInstanceOf(UrlBaseIAInvalidaError);
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("https con hostname que resuelve a IP pública: ok, devuelve la URL parseada", async () => {
    lookupMock.mockResolvedValue([{ address: "203.0.113.10" }]); // TEST-NET-3, RFC 5737
    const url = await exigirUrlBaseIASegura("https://mi-servidor.test/v1");
    expect(url.hostname).toBe("mi-servidor.test");
  });

  it("https con hostname que resuelve a IP privada (RFC 1918): UrlBaseIAInvalidaError", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5" }]);
    await expect(exigirUrlBaseIASegura("https://interno.test/v1")).rejects.toBeInstanceOf(UrlBaseIAInvalidaError);
  });

  it("https con hostname que resuelve a la IP de metadata de nube (169.254.169.254): UrlBaseIAInvalidaError", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254" }]);
    await expect(exigirUrlBaseIASegura("https://parece-publico.test/v1")).rejects.toBeInstanceOf(UrlBaseIAInvalidaError);
  });

  it("https con hostname que no resuelve: UrlBaseIAInvalidaError, nunca una excepción cruda de dns", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(exigirUrlBaseIASegura("https://no-existe.test/v1")).rejects.toBeInstanceOf(UrlBaseIAInvalidaError);
  });
});
