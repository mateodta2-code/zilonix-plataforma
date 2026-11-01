import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("dns/promises", () => ({ lookup: vi.fn() }));

import { lookup } from "dns/promises";
import { esIpPrivadaOEspecial, exigirHostnamePublico, HostnameNoResueltoError, HostnamePrivadoError } from "./ssrf";

const lookupMock = lookup as unknown as ReturnType<typeof vi.fn>;

describe("esIpPrivadaOEspecial", () => {
  it("reconoce los rangos privados reales (RFC 1918) y loopback", () => {
    expect(esIpPrivadaOEspecial("10.0.0.1")).toBe(true);
    expect(esIpPrivadaOEspecial("172.16.0.1")).toBe(true);
    expect(esIpPrivadaOEspecial("172.31.255.255")).toBe(true);
    expect(esIpPrivadaOEspecial("192.168.1.1")).toBe(true);
    expect(esIpPrivadaOEspecial("127.0.0.1")).toBe(true);
  });

  it("reconoce la IP de metadata de nube (169.254.169.254) y el resto de link-local", () => {
    expect(esIpPrivadaOEspecial("169.254.169.254")).toBe(true);
    expect(esIpPrivadaOEspecial("169.254.1.1")).toBe(true);
  });

  it("reconoce CGNAT (RFC 6598, 100.64.0.0/10)", () => {
    expect(esIpPrivadaOEspecial("100.64.0.1")).toBe(true);
    expect(esIpPrivadaOEspecial("100.127.255.255")).toBe(true);
  });

  it("IPv6 loopback/link-local/unique-local", () => {
    expect(esIpPrivadaOEspecial("::1")).toBe(true);
    expect(esIpPrivadaOEspecial("fe80::1")).toBe(true);
    expect(esIpPrivadaOEspecial("fc00::1")).toBe(true);
    expect(esIpPrivadaOEspecial("fd12::1")).toBe(true);
  });

  it("IPv4 pública real: false", () => {
    expect(esIpPrivadaOEspecial("151.101.1.1")).toBe(false);
    expect(esIpPrivadaOEspecial("8.8.8.8")).toBe(false);
  });

  it("ni IPv4 ni IPv6 real: true, nunca se asume pública", () => {
    expect(esIpPrivadaOEspecial("no-es-una-ip")).toBe(true);
  });
});

describe("exigirHostnamePublico", () => {
  afterEach(() => {
    lookupMock.mockReset();
  });

  it("DNS no resuelve: HostnameNoResueltoError", async () => {
    lookupMock.mockRejectedValue(new Error("ENOTFOUND"));
    await expect(exigirHostnamePublico("no-existe.example")).rejects.toThrow(HostnameNoResueltoError);
  });

  it("resuelve a una IP privada: HostnamePrivadoError", async () => {
    lookupMock.mockResolvedValue([{ address: "10.0.0.5" }]);
    await expect(exigirHostnamePublico("interno.example")).rejects.toThrow(HostnamePrivadoError);
  });

  it("resuelve a varias IPs, alguna privada: HostnamePrivadoError (nunca basta con que UNA sea pública)", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }, { address: "169.254.169.254" }]);
    await expect(exigirHostnamePublico("mixto.example")).rejects.toThrow(HostnamePrivadoError);
  });

  it("resuelve a IPs públicas reales: resuelve sin lanzar", async () => {
    lookupMock.mockResolvedValue([{ address: "151.101.1.1" }]);
    await expect(exigirHostnamePublico("cdn.example")).resolves.toBeUndefined();
  });

  it("sin ninguna dirección resuelta: HostnamePrivadoError (nunca se asume público por defecto)", async () => {
    lookupMock.mockResolvedValue([]);
    await expect(exigirHostnamePublico("vacio.example")).rejects.toThrow(HostnamePrivadoError);
  });
});
