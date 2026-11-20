import { afterEach, describe, expect, it, vi } from "vitest";
import { descargarMiniatura } from "./miniaturasServidor";

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
function resp(status: number, body?: Uint8Array, headers: Record<string, string> = {}): Response {
  return new Response(body ?? null, { status, headers });
}
afterEach(() => vi.unstubAllGlobals());

describe("descargarMiniatura", () => {
  it("baja una miniatura válida", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, JPG)));
    expect((await descargarMiniatura("https://http2.mlstatic.com/a.jpg"))?.mediaType).toBe("image/jpeg");
  });
  it("no hace fetch si el host no es de la lista blanca", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await descargarMiniatura("https://mlstatic.com.evil.com/a.jpg")).toBeNull();
    expect(await descargarMiniatura("http://http2.mlstatic.com/a.jpg")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it("rechaza redirect a otro host", async () => {
    const f = vi.fn(async () => resp(302, undefined, { location: "https://evil.com/a.jpg" }));
    vi.stubGlobal("fetch", f);
    expect(await descargarMiniatura("https://http2.mlstatic.com/a.jpg")).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("rechaza más de 300 KB, y lo que no es imagen", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, new Uint8Array(301 * 1024).fill(0xff))));
    expect(await descargarMiniatura("https://http2.mlstatic.com/a.jpg")).toBeNull();
    vi.stubGlobal("fetch", vi.fn(async () => resp(200, new TextEncoder().encode("<html>"))));
    expect(await descargarMiniatura("https://http2.mlstatic.com/a.jpg")).toBeNull();
  });
});
