import { afterEach, describe, expect, it, vi } from "vitest";
import { MlSinPermisoAppError, linkPublicacion } from "@/lib/ml/cliente";
import {
  CODIGO_SIN_PERMISO_PUBLICIDAD,
  SUGERENCIA_RECONECTAR_PUBLICIDAD,
  anunciosDeAdGroup,
  listarCampanas,
  metricasAdGroupsDelDia,
  metricasDiariasCuenta,
  obtenerAnunciante,
} from "./publicidad";

function respuesta(status: number, body: unknown): Response {
  const texto = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => texto } as Response;
}

describe("cliente de Product Ads, solo lectura (issue #254)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("advertisers usa Api-Version 1 y distingue 404 de cuenta sin Product Ads y 403 de la app", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuesta(404, { message: "No permissions found for user_id", status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(obtenerAnunciante("token-prueba")).resolves.toEqual({ estado: "sin_product_ads" });
    const primera = fetchMock.mock.calls[0];
    expect(primera[0]).toBe("https://api.mercadolibre.com/advertising/advertisers?product_id=PADS");
    expect(primera[1].headers["Api-Version"]).toBe("1");
    expect(primera[1].method ?? "GET").toBe("GET");

    fetchMock.mockResolvedValueOnce(
      respuesta(403, { code: CODIGO_SIN_PERMISO_PUBLICIDAD, message: "blocked", blocked_by: "PolicyAgent" })
    );
    const sinPermiso = await obtenerAnunciante("token-prueba");
    expect(sinPermiso).toEqual({
      estado: "sin_permiso_app",
      sugerencia: SUGERENCIA_RECONECTAR_PUBLICIDAD,
      codigo: CODIGO_SIN_PERMISO_PUBLICIDAD,
    });
  });

  it("un 403 de advertisers es MlSinPermisoAppError por dentro y sugiere reconectar", async () => {
    const fetchMock = vi.fn(async (_url: string, init: { headers: Record<string, string> }) => {
      expect(init.headers.Authorization).toBe("Bearer token-prueba");
      return respuesta(403, { code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const resultado = await obtenerAnunciante("token-prueba");
    expect(resultado.estado).toBe("sin_permiso_app");
    if (resultado.estado === "sin_permiso_app") expect(resultado.sugerencia).toMatch(/Reconectá la cuenta/);
  });

  it("elige el anunciante MCO y el resto de rutas manda api-version 2", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respuesta(200, {
          advertisers: [
            { advertiser_id: 111, site_id: "MLM", advertiser_name: "Otro", account_name: "MLM" },
            { advertiser_id: 222, site_id: "MCO", advertiser_name: "Tienda", account_name: "MCO - Tienda" },
          ],
        })
      )
      .mockResolvedValue(
        respuesta(200, { paging: { total: 1, offset: 0, limit: 50 }, results: [{ id: 355771832, name: "Campaña", status: "active" }] })
      );
    vi.stubGlobal("fetch", fetchMock);

    const anunciante = await obtenerAnunciante("token-prueba");
    expect(anunciante).toMatchObject({ estado: "ok", advertiserId: "222", siteId: "MCO", nombre: "Tienda" });
    if (anunciante.estado !== "ok") return;

    await listarCampanas({ token: "token-prueba", siteId: anunciante.siteId, advertiserId: anunciante.advertiserId }, { estado: "paused" });
    const urlLista = String(fetchMock.mock.calls[1][0]);
    expect(urlLista).toContain("/advertising/MCO/advertisers/222/product_ads/campaigns/search");
    expect(urlLista).toContain("filters[status]=paused");
    expect(fetchMock.mock.calls[1][1].headers["api-version"]).toBe("2");

    await metricasDiariasCuenta(
      { token: "token-prueba", siteId: "MCO", advertiserId: "222" },
      { desde: "2026-10-01", hasta: "2026-10-26" }
    );
    expect(String(fetchMock.mock.calls[2][0])).toContain("aggregation_type=DAILY");

    await metricasAdGroupsDelDia({ token: "token-prueba", siteId: "MCO", advertiserId: "222" }, "355771832", "2026-10-26");
    const urlDia = String(fetchMock.mock.calls[3][0]);
    expect(urlDia).toContain("/advertising/MCO/product_ads/campaigns/355771832/ad_groups/metrics");
    expect(urlDia).toContain("date_from=2026-10-26");
    expect(urlDia).toContain("date_to=2026-10-26");

    await anunciosDeAdGroup({ token: "token-prueba", siteId: "MCO", advertiserId: "222" }, "1406314785", {
      desde: "2026-10-26",
      hasta: "2026-10-26",
    });
    expect(String(fetchMock.mock.calls[4][0])).toContain("/advertising/MCO/product_ads/ad_groups/1406314785/ads");

    const metodos = fetchMock.mock.calls.map((call) => (call[1] as { method?: string }).method ?? "GET");
    expect(metodos.every((m) => m === "GET")).toBe(true);
  });

  it("rechaza un site o un id que no son los de la doc, sin llamar a la API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      listarCampanas({ token: "token-prueba", siteId: "MCO/../users", advertiserId: "1" }, {})
    ).rejects.toThrow(/inválido/);
    await expect(metricasAdGroupsDelDia({ token: "t", siteId: "MCO", advertiserId: "1" }, "1", "26-10-2026")).rejects.toThrow(/fecha/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("el link de publicación lleva el guion de Mercado Libre Colombia", () => {
    expect(linkPublicacion("MCO123456")).toBe("https://articulo.mercadolibre.com.co/MCO-123456");
  });

  it("el 403 de lectura sigue siendo MlSinPermisoAppError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(403, { code: "OTRO" })));
    await expect(obtenerAnunciante("token-prueba")).resolves.toMatchObject({ estado: "sin_permiso_app", codigo: "OTRO" });
    expect(new MlSinPermisoAppError("/advertising/advertisers", "PA_UNAUTHORIZED_RESULT_FROM_POLICIES").codigoPolitica).toBe(
      "PA_UNAUTHORIZED_RESULT_FROM_POLICIES"
    );
  });
});
