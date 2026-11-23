import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn() }));
vi.mock("@/lib/ml/pedidos", () => ({ registrarEventoPedido: vi.fn() }));
vi.mock("@/lib/ml/despachos", () => ({ sincronizarDespacho: vi.fn() }));
vi.mock("@/lib/ml/ventas-finanzas", () => ({ guardarOrdenMl: vi.fn() }));
import { DIAS_HACIA_ATRAS, traerPedidosReales, ventanasDeFechas } from "./importacion";

// Issue #567 — historial de 1 año por ventanas de fechas. Sin base de datos:
// solo la lectura de /orders/search, con fetch simulado.
const AHORA = Date.parse("2026-11-23T12:00:00.000Z");
const ok = (results: unknown[]) => ({ ok: true, status: 200, json: async () => ({ results }), headers: new Headers() }) as unknown as Response;
const fallo = (status: number, headers: Record<string, string> = {}) =>
  ({ ok: false, status, json: async () => ({ message: "x" }), headers: new Headers(headers) }) as unknown as Response;
const pedido = (id: number) => ({ id, date_created: "2026-10-01T00:00:00.000Z", status: "paid", total_amount: 1, currency_id: "X" });

afterEach(() => vi.unstubAllGlobals());

describe("historial de pedidos (issue #567)", () => {
  it("la constante es 365 y las ventanas cubren ~365 días sin huecos", () => {
    expect(DIAS_HACIA_ATRAS).toBe(365);
    const v = ventanasDeFechas(AHORA);
    expect(v.length).toBe(13);
    expect(Date.parse(v[0].hasta)).toBe(AHORA);
    expect(Date.parse(v[v.length - 1].desde)).toBe(AHORA - 365 * 86_400_000);
    for (let i = 1; i < v.length; i++) expect(v[i].hasta).toBe(v[i - 1].desde);
  });

  it("pide cada ventana con from/to y pagina dentro de la ventana", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url);
      if (urls.length === 1) return ok(Array.from({ length: 50 }, (_, i) => pedido(i + 1)));
      if (urls.length === 2) return ok([pedido(51)]);
      return ok([]);
    });
    const r = await traerPedidosReales("tok", "9", AHORA);
    expect(r.length).toBe(51);
    expect(new URL(urls[1]).searchParams.get("offset")).toBe("50");
    expect(new URL(urls[0]).searchParams.get("order.date_created.to")).toBe(new Date(AHORA).toISOString());
    expect(urls.length).toBe(2 + 12);
  });

  it("reintenta un 429 esperando Retry-After", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++ === 0 ? fallo(429, { "retry-after": "0" }) : ok([])));
    await expect(traerPedidosReales("tok", "9", AHORA)).resolves.toEqual([]);
    expect(n).toBe(14);
  });

  it("una ventana vieja rechazada por rango se omite sin error fatal", async () => {
    let n = 0;
    vi.stubGlobal("fetch", async () => (n++ === 3 ? fallo(400) : ok([pedido(n)])));
    const r = await traerPedidosReales("tok", "9", AHORA);
    expect(r.length).toBe(12);
  });

  it("un 403 sigue siendo fatal y el error no trae tokens", async () => {
    vi.stubGlobal("fetch", async () => fallo(403));
    await expect(traerPedidosReales("tok-secreto", "9", AHORA)).rejects.toThrow(/403/);
  });
});
