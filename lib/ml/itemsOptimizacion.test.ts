import { afterEach, describe, expect, it, vi } from "vitest";
import { leerItemsOptimizacionMl, visitasCuentaMl } from "@/lib/ml/cliente";

// Optimización — /items?ids= a veces responde 403 a todo el lote aunque
// cada publicación se lea bien sola (staging, 19-nov). Las que faltaron
// se piden una por una.

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const ITEM = (id: string) => ({ id, title: `Publicación ${id}`, status: "active", price: 1000 });

describe("leerItemsOptimizacionMl", () => {
  it("si el lote responde 403, pide cada publicación por separado", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const f = vi.fn(async (url: string) => {
      if (url.includes("/items?ids=")) return json({ message: "forbidden", error: "forbidden" }, 403);
      const id = url.split("/items/")[1].split("?")[0];
      return json(ITEM(id));
    });
    globalThis.fetch = f as unknown as typeof fetch;
    const items = await leerItemsOptimizacionMl(["MCO1342632705"], "token");
    expect(items.map((i) => i.id)).toEqual(["MCO1342632705"]);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1][0])).toContain("/items/MCO1342632705?attributes=");
  });

  it("con el lote bien, no hace llamadas de más; solo reintenta las que faltaron", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("/items?ids=")) return json([{ code: 200, body: ITEM("MCO111111111") }, { code: 403, body: {} }]);
      return json({ message: "not_found" }, 404);
    });
    globalThis.fetch = f as unknown as typeof fetch;
    const items = await leerItemsOptimizacionMl(["MCO111111111", "MCO222222222"], "token");
    expect(items.map((i) => i.id)).toEqual(["MCO111111111"]);
    expect(f).toHaveBeenCalledTimes(2);
    expect(String(f.mock.calls[1][0])).toContain("/items/MCO222222222?");
  });

  it("si la individual también falla, la publicación queda fuera sin tumbar las demás", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => json({ message: "forbidden" }, 403)) as unknown as typeof fetch;
    expect(await leerItemsOptimizacionMl(["MCO111111111"], "token")).toEqual([]);
  });
});

describe("visitasCuentaMl (visitas de toda la tienda)", () => {
  it("pide /users/{id}/items_visits con el rango y lee total_visits", async () => {
    const f = vi.fn(async () => json({ user_id: 24484425, total_visits: 529 }));
    globalThis.fetch = f as unknown as typeof fetch;
    expect(await visitasCuentaMl("24484425", "token", "2026-11-13", "2026-11-20")).toBe(529);
    expect(String((f.mock.calls[0] as unknown[])[0])).toContain("/users/24484425/items_visits?date_from=2026-11-13&date_to=2026-11-20");
  });

  it("si Mercado Libre falla o el dato es raro, null (nunca un 0 inventado)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    globalThis.fetch = vi.fn(async () => json({ message: "forbidden" }, 403)) as unknown as typeof fetch;
    expect(await visitasCuentaMl("24484425", "token", "2026-11-13", "2026-11-20")).toBeNull();
    expect(await visitasCuentaMl("abc", "token", "2026-11-13", "2026-11-20")).toBeNull();
  });
});
