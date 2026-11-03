import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calcularCodeChallenge,
  construirUrlAutorizacion,
  generarCodeVerifier,
  generarState,
  intercambiarCodigo,
  renovarToken,
  revocarTokenSiEsPosible,
} from "./oauth";

function respuestaOk(data: unknown) {
  return { ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

function respuestaError(status: number, texto: string) {
  return { ok: false, status, json: async () => ({}), text: async () => texto } as Response;
}

describe("OAuth de Canva", () => {
  beforeEach(() => {
    process.env.CANVA_CLIENT_ID = "id-de-prueba";
    process.env.CANVA_CLIENT_SECRET = "secret-de-prueba";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("intercambiarCodigo manda grant_type=authorization_code con el code, el redirect_uri y el code_verifier (PKCE)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(respuestaOk({ access_token: "token-abc", refresh_token: "refresh-xyz", expires_in: 14_400 }));

    const tokens = await intercambiarCodigo("un-code", "https://web-staging-d979.up.railway.app/api/canva/callback", "un-code-verifier");

    expect(tokens).toEqual({ accessToken: "token-abc", refreshToken: "refresh-xyz", expiraEnSegundos: 14_400 });
    const [url, opciones] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.canva.com/rest/v1/oauth/token");
    const body = new URLSearchParams(opciones!.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("un-code");
    expect(body.get("redirect_uri")).toBe("https://web-staging-d979.up.railway.app/api/canva/callback");
    expect(body.get("code_verifier")).toBe("un-code-verifier");
    expect(body.get("client_id")).toBe("id-de-prueba");
    expect(body.get("client_secret")).toBe("secret-de-prueba");
  });

  it("renovarToken manda grant_type=refresh_token con el refresh_token", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(respuestaOk({ access_token: "token-nuevo", refresh_token: "refresh-nuevo", expires_in: 14_400 }));

    await renovarToken("refresh-viejo");

    const [, opciones] = fetchMock.mock.calls[0];
    const body = new URLSearchParams(opciones!.body as string);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-viejo");
  });

  it("si Canva no devuelve refresh_token, falla con un mensaje explicable", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(respuestaOk({ access_token: "token-abc", expires_in: 14_400 }));

    await expect(intercambiarCodigo("code", "https://x/callback", "verifier")).rejects.toThrow(/refresh_token/);
  });

  it("si Canva responde con error, se ve el status y el cuerpo del error", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(respuestaError(400, "invalid_grant: code ya usado o vencido"));

    await expect(intercambiarCodigo("code-vencido", "https://x/callback", "verifier")).rejects.toThrow(/400/);
  });

  it("sin CANVA_CLIENT_ID/SECRET en el entorno, falla antes de llamar a Canva", async () => {
    delete process.env.CANVA_CLIENT_ID;
    const fetchMock = vi.mocked(fetch);

    await expect(intercambiarCodigo("code", "https://x/callback", "verifier")).rejects.toThrow(/CANVA_CLIENT_ID/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("generarCodeVerifier da un string distinto cada vez, de al menos 43 caracteres (mínimo de RFC 7636)", () => {
    const a = generarCodeVerifier();
    const b = generarCodeVerifier();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("calcularCodeChallenge es determinista (mismo verifier siempre da el mismo challenge)", () => {
    const verifier = generarCodeVerifier();
    expect(calcularCodeChallenge(verifier)).toBe(calcularCodeChallenge(verifier));
    expect(calcularCodeChallenge(verifier)).not.toBe(verifier);
  });

  it("construirUrlAutorizacion incluye scope, code_challenge, code_challenge_method=S256 y state", () => {
    const url = construirUrlAutorizacion("https://x/callback", "un-challenge", "un-state");
    const parsed = new URL(url);
    expect(parsed.hostname).toBe("www.canva.com");
    expect(parsed.searchParams.get("scope")).toBe("design:content:read design:meta:read asset:read");
    expect(parsed.searchParams.get("code_challenge")).toBe("un-challenge");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("https://x/callback");
    expect(parsed.searchParams.get("state")).toBe("un-state");
  });

  it("generarState da un string distinto cada vez, de al menos 43 caracteres", () => {
    const a = generarState();
    const b = generarState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThanOrEqual(43);
  });

  it("revocarTokenSiEsPosible nunca lanza, ni cuando Canva responde error ni cuando la red falla", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(respuestaError(404, "no existe ese endpoint"));
    await expect(revocarTokenSiEsPosible("refresh-cualquiera")).resolves.toBeUndefined();

    fetchMock.mockRejectedValueOnce(new Error("red caída"));
    await expect(revocarTokenSiEsPosible("refresh-cualquiera")).resolves.toBeUndefined();
  });
});
