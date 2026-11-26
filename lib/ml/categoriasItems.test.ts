import { afterEach, describe, expect, it, vi } from "vitest";
import { categoriasItemsMl } from "@/lib/ml/cliente";

// Optimización · Rendimiento: categoría de cada publicación por multiget.

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

const ids = (n: number, desde = 1) => Array.from({ length: n }, (_, i) => `MCO${desde + i}`);
const pedidos = (url: string) => decodeURIComponent(url.split("ids=")[1].split("&")[0]).split(",");
const cuerpo = (id: string) => ({ code: 200, body: { id, category_id: `MCO-CAT-${id.slice(3)}` } });

describe("categoriasItemsMl", () => {
  it("pide solo id y category_id, en lotes de 20, y arma el mapa", async () => {
    const f = vi.fn(async (url: string) => json(pedidos(url).map(cuerpo)));
    globalThis.fetch = f as unknown as typeof fetch;
    const mapa = await categoriasItemsMl(ids(45), "token");
    expect(f).toHaveBeenCalledTimes(3);
    expect(pedidos(String(f.mock.calls[0][0]))).toHaveLength(20);
    expect(pedidos(String(f.mock.calls[2][0]))).toHaveLength(5);
    expect(String(f.mock.calls[0][0])).toContain("attributes=id,category_id");
    expect(mapa.size).toBe(45);
    expect(mapa.get("MCO7")).toBe("MCO-CAT-7");
  });

  it("un lote que falla no tumba los demás", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let n = 0;
    const f = vi.fn(async (url: string) => (++n === 2 ? json({ message: "forbidden" }, 403) : json(pedidos(url).map(cuerpo))));
    globalThis.fetch = f as unknown as typeof fetch;
    const mapa = await categoriasItemsMl(ids(45), "token");
    expect(mapa.size).toBe(25);
    expect(mapa.has("MCO1")).toBe(true);
    expect(mapa.has("MCO21")).toBe(false);
    expect(mapa.has("MCO45")).toBe(true);
  });

  it("ignora filas que no son 200, ids inválidos y repetidos", async () => {
    const f = vi.fn(async (url: string) => json(pedidos(url).map((id) => (id === "MCO2" ? { code: 404, body: { message: "no" } } : cuerpo(id)))));
    globalThis.fetch = f as unknown as typeof fetch;
    const mapa = await categoriasItemsMl(["MCO1", "MCO2", "MCO1", "x; drop", ""], "token");
    expect(pedidos(String(f.mock.calls[0][0]))).toEqual(["MCO1", "MCO2"]);
    expect([...mapa.keys()]).toEqual(["MCO1"]);
  });

  it("sin ids no llama a Mercado Libre", async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    expect((await categoriasItemsMl([], "token")).size).toBe(0);
    expect(f).not.toHaveBeenCalled();
  });
});
