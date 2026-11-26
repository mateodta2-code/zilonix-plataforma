import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contarItemsVendedorPorEstadoMl,
  idsItemsVendedorPorEstadoMl,
  itemsConReferenciaPrecioMl,
  leerItemsConReferenciaPrecio,
  leerModeracionItem,
  leerReferenciaPrecioItem,
  referenciaPrecioItemMl,
  ultimaModeracionItemMl,
  type EstadoModeracionMl,
} from "@/lib/ml/cliente";

// Optimización — alertas de solo lectura, con Mercado Libre simulado.
const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
function simular(fn: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const f = vi.fn(async (url: string, init?: RequestInit) => fn(url, init));
  globalThis.fetch = f as unknown as typeof fetch;
  return f;
}

describe("leerModeracionItem", () => {
  it("toma la primera moderación con motivo y solución", () => {
    const r = leerModeracionItem({
      moderations: [
        { date_created: "2026-11-20T10:00:00Z", wordings: [{ type: "REASON", value: " Infringe políticas " }, { type: "REMEDY", value: "Edita el título" }] },
        { wordings: [{ type: "REASON", value: "otra" }] },
      ],
    });
    expect(r).toEqual({ motivo: "Infringe políticas", solucion: "Edita el título", fecha: "2026-11-20T10:00:00Z" });
  });
  it("arreglo en la raíz: ejemplo de la doc (POOR_QUALITY_THUMBNAIL con REASON y REMEDY)", () => {
    const r = leerModeracionItem([
      {
        name: "POOR_QUALITY_THUMBNAIL",
        id: "ab12cd34",
        date_created: "2026-11-20T10:00:00.000Z",
        evidences: [],
        wordings: [
          { type: "REASON", value: "La imagen principal no cumple con la calidad requerida." },
          { type: "REMEDY", value: "Sube una imagen nítida, con fondo blanco y sin textos." },
        ],
      },
    ]);
    expect(r).toEqual({
      motivo: "La imagen principal no cumple con la calidad requerida.",
      solucion: "Sube una imagen nítida, con fondo blanco y sin textos.",
      fecha: "2026-11-20T10:00:00.000Z",
    });
  });
  it("arreglo en la raíz: DENYLIST solo con REASON", () => {
    const r = leerModeracionItem([
      { name: "DENYLIST", id: "ef56", date_created: "2026-11-21T09:00:00.000Z", evidences: [], wordings: [{ type: "REASON", value: "Producto prohibido en Mercado Libre." }] },
    ]);
    expect(r).toEqual({ motivo: "Producto prohibido en Mercado Libre.", solucion: null, fecha: "2026-11-21T09:00:00.000Z" });
  });
  it("sin REMEDY deja solo el motivo", () => {
    expect(leerModeracionItem({ moderations: [{ wordings: [{ type: "REASON", value: "Motivo" }] }] })).toEqual({ motivo: "Motivo", solucion: null, fecha: null });
  });
  it("vacío o raro → null", () => {
    expect(leerModeracionItem({ moderations: [] })).toBeNull();
    expect(leerModeracionItem(null)).toBeNull();
    expect(leerModeracionItem({ moderations: [{ wordings: [] }] })).toBeNull();
  });
});

describe("leerItemsConReferenciaPrecio", () => {
  it("lee total e ids válidos", () => {
    expect(leerItemsConReferenciaPrecio({ total: 3, items: ["MCO1", "xx", 5, "MCO2"] })).toEqual({ total: 3, ids: ["MCO1", "MCO2"] });
  });
  it("sin total usa los ids; sin arreglo → null", () => {
    expect(leerItemsConReferenciaPrecio({ items: ["MCO1"] })).toEqual({ total: 1, ids: ["MCO1"] });
    expect(leerItemsConReferenciaPrecio({})).toBeNull();
  });
});

describe("leerReferenciaPrecioItem", () => {
  it("lee estado, precios, diferencia y moneda", () => {
    expect(
      leerReferenciaPrecioItem({
        status: "with_benchmark_highest",
        current_price: { amount: 120000, currency_id: "COP" },
        suggested_price: { amount: 100000 },
        percent_difference: 20,
      })
    ).toEqual({ estado: "with_benchmark_highest", precioActual: 120000, precioSugerido: 100000, diferenciaPorcentaje: 20, moneda: "COP" });
  });
  it("campos que faltan quedan en null, nunca 0", () => {
    expect(leerReferenciaPrecioItem({})).toEqual({ estado: null, precioActual: null, precioSugerido: null, diferenciaPorcentaje: null, moneda: null });
    expect(leerReferenciaPrecioItem(null)).toBeNull();
  });
});

describe("funciones de cliente (solo GET)", () => {
  it("cuenta por estado con limit=1 y lee paging.total", async () => {
    const f = simular(() => json({ results: ["MCO1"], paging: { total: 7 } }));
    expect(await contarItemsVendedorPorEstadoMl("123", "t", "under_review")).toBe(7);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit | undefined];
    expect(url).toContain("/users/123/items/search?status=under_review&limit=1");
    expect(init?.method ?? "GET").toBe("GET");
  });
  it("estado fuera de la lista blanca no llama a ML", async () => {
    const f = simular(() => json({}));
    await expect(contarItemsVendedorPorEstadoMl("123", "t", "closed" as EstadoModeracionMl)).rejects.toThrow();
    await expect(idsItemsVendedorPorEstadoMl("123", "t", "active" as EstadoModeracionMl, 0, 50)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
  it("si ML falla → null", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    simular(() => json({}, 500));
    expect(await contarItemsVendedorPorEstadoMl("123", "t", "pending")).toBeNull();
    expect(await idsItemsVendedorPorEstadoMl("123", "t", "pending", 0, 50)).toBeNull();
    expect(await itemsConReferenciaPrecioMl("123", "t")).toBeNull();
    expect(await referenciaPrecioItemMl("MCO1", "t")).toBeNull();
    expect(await ultimaModeracionItemMl("MCO1", "t")).toBeNull();
  });
  it("ids por estado: página y total", async () => {
    const f = simular(() => json({ results: ["MCO1", "MCO2"], paging: { total: 9 } }));
    expect(await idsItemsVendedorPorEstadoMl("123", "t", "pending", 50, 50)).toEqual({ ids: ["MCO1", "MCO2"], total: 9 });
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("status=pending&limit=50&offset=50");
  });
  it("la moderación arma el sufijo -ITM", async () => {
    const f = simular(() => json({ moderations: [{ wordings: [{ type: "REASON", value: "x" }] }] }));
    expect((await ultimaModeracionItemMl("MCO99", "t"))?.motivo).toBe("x");
    expect((f.mock.calls[0] as unknown as [string])[0]).toContain("/moderations/last_moderation/MCO99-ITM");
  });
  it("referencia de precio: 404 → null y rutas documentadas", async () => {
    const f = simular((url) => (url.includes("/details") ? json({ message: "not found" }, 404) : json({ total: 1, items: ["MCO1"] })));
    expect(await referenciaPrecioItemMl("MCO1", "t")).toBeNull();
    expect(await itemsConReferenciaPrecioMl("123", "t")).toEqual({ total: 1, ids: ["MCO1"] });
    const urls = f.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(urls[0]).toContain("/suggestions/items/MCO1/details");
    expect(urls[1]).toContain("/suggestions/user/123/items");
  });
  it("rechaza ids mal formados", async () => {
    simular(() => json({}));
    await expect(ultimaModeracionItemMl("../x", "t")).rejects.toThrow();
    await expect(itemsConReferenciaPrecioMl("abc", "t")).rejects.toThrow();
  });
});
