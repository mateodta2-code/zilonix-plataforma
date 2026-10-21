import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dbComoEmpresa } from "@/db/empresa-context";
import { cuentasMl, empresas } from "@/db/schema";
import { cifrarToken } from "@/lib/cifrado";
import { buscarItemPorSku, ClipInvalidoError, subirClipItem, validarArchivoClip } from "./clip";

function jsonRes(status: number, data: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => data, text: async () => JSON.stringify(data) } as Response;
}

async function crearEmpresaYCuenta() {
  const empresaId = randomUUID();
  await dbComoEmpresa(empresaId, (tx) => tx.insert(empresas).values({ id: empresaId, nombre: "Empresa clip", nit: `TEST-CLIP-${empresaId.slice(0, 8)}` }));
  const [cuenta] = await dbComoEmpresa(empresaId, (tx) =>
    tx
      .insert(cuentasMl)
      .values({
        empresaId,
        cuentaIdExterna: `ml-user-clip-${randomUUID().slice(0, 8)}`,
        nickname: "VENDEDOR_CLIP",
        accessTokenCifrado: cifrarToken("access"),
        refreshTokenCifrado: cifrarToken("refresh"),
        tokenExpiraTs: new Date(Date.now() + 3600_000),
      })
      .returning({ id: cuentasMl.id, cuentaIdExterna: cuentasMl.cuentaIdExterna })
  );
  return { empresaId, cuenta };
}

describe("buscarItemPorSku (tarea 2.11, §10) — búsqueda real por seller_sku, sin descargar el catálogo completo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("encuentra el item por SKU real", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) => {
        const u = String(url);
        if (u.includes("/items/search")) return jsonRes(200, { results: ["MCO999"] });
        if (u.includes("/items/MCO999")) return jsonRes(200, { id: "MCO999", title: "Producto encontrado", thumbnail: "https://x/thumb.jpg" });
        throw new Error(`no mockeado: ${u}`);
      })
    );
    const r = await buscarItemPorSku(empresaId, cuenta, "SKU-REAL");
    expect(r?.itemId).toBe("MCO999");
    expect(r?.titulo).toBe("Producto encontrado");
  });

  it("sin coincidencias, devuelve null", async () => {
    const { empresaId, cuenta } = await crearEmpresaYCuenta();
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { results: [] })));
    const r = await buscarItemPorSku(empresaId, cuenta, "SKU-INEXISTENTE");
    expect(r).toBeNull();
  });
});

describe("subirClipItem (tarea 2.11, §10) — único endpoint del flujo nunca confirmado contra una cuenta real", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sube el video y devuelve el estado de moderación", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonRes(200, { status: "accepted", clip_uuid: "abc-123", site_ids: ["MCO"] })));
    const r = await subirClipItem("token", "MCO111", Buffer.from("video"), "clip.mp4", "video/mp4");
    expect(r.status).toBe("accepted");
    expect(r.clipUuid).toBe("abc-123");
  });

  it("avisa claro cuando la cuenta no tiene reputación todavía (Mateo, 28/9, FullyLemon)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" }) as Response));
    await expect(subirClipItem("token", "MCO111", Buffer.from("video"), "clip.mp4", "video/mp4")).rejects.toThrow(/color de reputación/);
  });
});

describe("validarArchivoClip — requisitos reales documentados por Mercado Libre, nunca validados en el sistema actual", () => {
  it("rechaza un tipo de archivo que no es video", () => {
    expect(() => validarArchivoClip("image/png", 1000)).toThrow(ClipInvalidoError);
  });
  it("rechaza un video de más de 280MB", () => {
    expect(() => validarArchivoClip("video/mp4", 300 * 1024 * 1024)).toThrow(ClipInvalidoError);
  });
  it("acepta un MP4 dentro del tamaño real", () => {
    expect(() => validarArchivoClip("video/mp4", 10 * 1024 * 1024)).not.toThrow();
  });
});
