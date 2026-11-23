import { afterEach, describe, expect, it, vi } from "vitest";
import { DIAS_HACIA_ATRAS, textoHistorialImportacion, traerPedidosReales } from "./importacion";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
const fallo = (status: number, cuerpo: unknown = {}) =>
  ({ ok: false, status, json: async () => cuerpo, headers: new Headers() }) as Response;
const DIA = 24 * 60 * 60 * 1000;
const sinEspera = async () => {};

// Issue #567 — fetch simulado, sin base de datos.
describe("pedidos: ventanas de fechas (issue #567)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("la constante es 365 y el texto sale de ella", () => {
    expect(DIAS_HACIA_ATRAS).toBe(365);
    expect(textoHistorialImportacion()).toBe("el último año");
  });

  it("pide ventanas consecutivas con from y to, y la primera parte ~365 días atrás", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string) => (urls.push(u), ok({ results: [] }))));
    const ahora = Date.now();
    await traerPedidosReales("tok", "1", new Date(ahora - DIAS_HACIA_ATRAS * DIA).toISOString(), { esperar: sinEspera, hastaMs: ahora });
    expect(urls.length).toBe(13);
    const from0 = new Date(decodeURIComponent(urls[0].match(/from=([^&]+)/)![1])).getTime();
    expect(Math.round((ahora - from0) / DIA)).toBe(365);
    expect(urls.every((u) => u.includes("order.date_created.to="))).toBe(true);
    expect(decodeURIComponent(urls[1].match(/from=([^&]+)/)![1])).toBe(decodeURIComponent(urls[0].match(/to=([^&]+)/)![1]));
  });

  it("pagina dentro de la ventana y no duplica pedidos", async () => {
    const pagina = (desde: number, n: number) => ({ results: Array.from({ length: n }, (_, i) => ({ id: desde + i })) });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string) => {
        if (u.includes("offset=0")) return ok(pagina(1, 50));
        if (u.includes("offset=50")) return ok(pagina(51, 10));
        return ok({ results: [] });
      })
    );
    const ahora = Date.now();
    const r = await traerPedidosReales("tok", "1", new Date(ahora - 20 * DIA).toISOString(), { esperar: sinEspera, hastaMs: ahora });
    expect(r).toHaveLength(60);
  });

  it("429: reintenta con espera y sigue", async () => {
    let n = 0;
    const esperar = vi.fn(async () => {});
    vi.stubGlobal("fetch", vi.fn(async () => (n++ < 2 ? fallo(429) : ok({ results: [{ id: 1 }] }))));
    const ahora = Date.now();
    const r = await traerPedidosReales("tok", "1", new Date(ahora - 5 * DIA).toISOString(), { esperar, hastaMs: ahora });
    expect(r).toHaveLength(1);
    expect(esperar).toHaveBeenCalledTimes(2);
  });

  it("ventana fuera de rango (400): se omite sin error fatal", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async () => (n++ === 0 ? fallo(400, { message: "date too old" }) : ok({ results: [{ id: n }] }))));
    const ahora = Date.now();
    const r = await traerPedidosReales("tok", "1", new Date(ahora - 40 * DIA).toISOString(), { esperar: sinEspera, hastaMs: ahora });
    expect(r).toHaveLength(1);
  });

  it("403 sigue siendo fatal y guarda el resumen sin token", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => fallo(403, { message: "Bearer APP_USR-123 bloqueado" })));
    await expect(traerPedidosReales("tok", "1", new Date(Date.now() - 5 * DIA).toISOString(), { esperar: sinEspera })).rejects.toThrow(/status=403/);
    await expect(traerPedidosReales("tok", "1", new Date(Date.now() - 5 * DIA).toISOString(), { esperar: sinEspera })).rejects.not.toThrow(/APP_USR-123/);
  });
});
