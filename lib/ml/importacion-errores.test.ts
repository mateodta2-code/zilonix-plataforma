import { afterEach, describe, expect, it, vi } from "vitest";
import { describirErrorImportacion, resumirCuerpoErrorMl, traerPublicacionesReales } from "./importacion";

const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data }) as Response;
const fallo = (status: number, cuerpo: unknown) => ({ ok: false, status, json: async () => cuerpo }) as Response;
const item = (id: string) => ({ id, title: `T ${id}`, price: 1, available_quantity: 1 });

// Issue #561 — fetch simulado, sin base de datos.
describe("publicaciones: errores de ML (issue #561)", () => {
  afterEach(() => vi.unstubAllGlobals());

  const listar = (url: string) => (url.includes("/items/search") ? ok({ results: ["A", "B"] }) : null);

  it("lote 200: lee todo sin omitidas", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => listar(url) ?? ok([{ code: 200, body: item("A") }, { code: 200, body: item("B") }])));
    const r = await traerPublicacionesReales("tok", "1");
    expect(r.publicaciones).toHaveLength(2);
    expect(r.omitidas).toBe(0);
  });

  it("lote 403: reintenta ítem por ítem y sigue", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/items/search")) return listar(url)!;
        if (url.includes("/items?ids=")) return fallo(403, { code: "forbidden", message: "sin acceso", cause: [] });
        if (url.includes("/items/A")) return ok(item("A"));
        return fallo(403, { error: "forbidden", message: "bloqueado" });
      })
    );
    const r = await traerPublicacionesReales("tok", "1");
    expect(r.publicaciones.map((p) => p.id)).toEqual(["A"]);
    expect(r.omitidas).toBe(1);
    expect(r.motivos[0]).toContain("status=403");
    expect(r.motivos[0]).toContain("bloqueado");
  });

  it("todos 403: no lanza, todas omitidas", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => listar(url) ?? fallo(403, { message: "no" })));
    const r = await traerPublicacionesReales("tok", "1");
    expect(r.publicaciones).toHaveLength(0);
    expect(r.omitidas).toBe(2);
  });

  it("filas con code distinto de 200 en el multiget se cuentan", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => listar(url) ?? ok([{ code: 200, body: item("A") }, { code: 404, body: { message: "no existe" } }])));
    const r = await traerPublicacionesReales("tok", "1");
    expect(r.omitidas).toBe(1);
  });

  it("el resumen del error no incluye tokens", () => {
    const t = resumirCuerpoErrorMl(403, { code: "forbidden", message: "Bearer APP_USR-123-abc rechazado", cause: ["access_token=xyz"] });
    expect(t).not.toMatch(/APP_USR|xyz/);
    expect(t).toContain("status=403");
  });

  it("describe el 403 en español con pista y distingue avisos", () => {
    const d = describirErrorImportacion("Mercado Libre respondió 403 al traer pedidos. [status=403]");
    expect(d.mensaje).toContain("negó el acceso (403)");
    expect(d.pista).toContain("DevCenter");
    expect(describirErrorImportacion("AVISO: 2 publicaciones no se pudieron leer").esAviso).toBe(true);
  });
});
