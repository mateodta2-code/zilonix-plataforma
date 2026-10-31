import { readFileSync } from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MlSinPermisoAppError, linkPublicacion } from "@/lib/ml/cliente";
import {
  CODIGO_SIN_PERMISO_PUBLICIDAD,
  SUGERENCIA_RECONECTAR_PUBLICIDAD,
  adGroupsDeCampana,
  anunciosDeAdGroup,
  listarCampanas,
  metricasAdGroupsDelDia,
  metricasDiariasCuenta,
  obtenerAnunciante,
} from "./publicidad";

function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

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

  it("revisa el deadline entre páginas, no antes de la primera", async () => {
    const pagina = {
      paging: { total: 120, offset: 0, limit: 50 },
      results: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })),
    };
    const orden: string[] = [];
    const fetchMock = vi.fn(async () => {
      orden.push("fetch");
      return respuesta(200, pagina);
    });
    vi.stubGlobal("fetch", fetchMock);
    const seguir = () => {
      orden.push("seguir");
      throw new Error("deadline");
    };
    await expect(
      listarCampanas({ token: "token-prueba", siteId: "MCO", advertiserId: "222" }, { estado: "active", seguir })
    ).rejects.toThrow(/deadline/);
    expect(orden).toEqual(["fetch", "seguir"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("revisa el deadline entre lotes de campañas al listar ad groups", async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta(200, { paging: { total: 1 }, results: [{ id: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);
    const campanas = Array.from({ length: 21 }, (_, i) => String(i + 1));
    const seguir = () => {
      throw new Error("deadline");
    };
    await expect(
      adGroupsDeCampana(
        { token: "t", siteId: "MCO", advertiserId: "222" },
        { campanas, desde: "2026-10-20", hasta: "2026-10-26", estado: "active", seguir }
      )
    ).rejects.toThrow(/deadline/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("hasta la fase 4 el cliente no escribe campañas: solo GET", () => {
    // La app de Mercado Libre tiene escritura. Esta fase no puede usarla.
    // Se mira el fuente, no una corrida: una función nueva que nadie llama
    // en los otros tests igual tiene que fallar acá.
    for (const ruta of ["lib/ml/publicidad.ts", "lib/ml/costos-item.ts"]) {
      const codigo = sinComentarios(readFileSync(ruta, "utf8"));
      expect(codigo, ruta).not.toMatch(/\b(POST|PUT|PATCH|DELETE)\b/);
      expect(codigo, ruta).not.toMatch(/\bfetch\s*\(/);
      expect(codigo, ruta).not.toMatch(/\bmethod\s*:/);
      expect(codigo, ruta).toContain("pedirLecturaMl");
    }
    const cliente = sinComentarios(readFileSync("lib/ml/cliente.ts", "utf8"));
    const inicio = cliente.indexOf("export async function pedirLecturaMl");
    const fin = cliente.indexOf("async function pedirTolerante");
    const lectura = cliente.slice(inicio, fin);
    expect(lectura).toContain("fetch(");
    expect(lectura).not.toMatch(/\bmethod\s*:/);
    expect(lectura).not.toMatch(/\b(POST|PUT|PATCH|DELETE)\b/);
  });

  it("el 403 de lectura sigue siendo MlSinPermisoAppError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(403, { code: "OTRO" })));
    await expect(obtenerAnunciante("token-prueba")).resolves.toMatchObject({ estado: "sin_permiso_app", codigo: "OTRO" });
    expect(new MlSinPermisoAppError("/advertising/advertisers", "PA_UNAUTHORIZED_RESULT_FROM_POLICIES").codigoPolitica).toBe(
      "PA_UNAUTHORIZED_RESULT_FROM_POLICIES"
    );
  });
});

// Staging, 30-oct (STOREKINGSAS): campaigns/search respondió 404 y la
// sincronización entera se cortaba sin guardar campañas.
describe("campaigns/search con 404 (fix-publicidad-404-campanas)", () => {
  const ctx = { token: "token-prueba", siteId: "MCO", advertiserId: "367254" };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("un 404 en un estado es lista vacía de ese estado; el otro estado sigue trayendo sus campañas", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      String(url).includes("filters%5Bstatus%5D=paused") || String(url).includes("filters[status]=paused")
        ? respuesta(404, { message: "not found", status: 404 })
        : respuesta(200, { paging: { total: 1 }, results: [{ id: 11, name: "Activa", status: "active" }] })
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(listarCampanas(ctx, { estado: "paused" })).resolves.toEqual([]);
    await expect(listarCampanas(ctx, { estado: "active" })).resolves.toEqual([{ id: 11, name: "Activa", status: "active" }]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/advertising/MCO/advertisers/367254/product_ads/campaigns/search");
  });

  it("las métricas diarias de cuenta con 404 son «sin filas», no un error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(404, { message: "not found", status: 404 })));
    await expect(metricasDiariasCuenta(ctx, { desde: "2026-10-01", hasta: "2026-10-30" })).resolves.toEqual([]);
  });

  it("un 404 a mitad de la paginación y cualquier otro error siguen cortando", async () => {
    const llena = { paging: { total: 120 }, results: Array.from({ length: 50 }, (_, i) => ({ id: i + 1 })) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(respuesta(200, llena)).mockResolvedValueOnce(respuesta(404, { status: 404 })));
    await expect(listarCampanas(ctx, { estado: "active" })).rejects.toThrow(/404/);

    // 400 y no 500: el cliente reintenta los 5xx y los reporta como timeout.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(400, { status: 400 })));
    await expect(listarCampanas(ctx, { estado: "active" })).rejects.toThrow(/400/);
  });

  it("los ad groups no cambian: un 404 sigue siendo error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(404, { status: 404 })));
    await expect(
      adGroupsDeCampana(ctx, { campanas: ["11"], desde: "2026-10-01", hasta: "2026-10-30", estado: "active" })
    ).rejects.toThrow(/404/);
  });
});
