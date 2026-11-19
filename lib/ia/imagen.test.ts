import { afterEach, describe, expect, it, vi } from "vitest";
import {
  descargarFotoBase,
  esUrlFotoBasePermitida,
  generarImagenDesdeFoto,
  leerTipoImagenIA,
  limpiarIndicaciones,
  MODELO_IMAGEN_GOOGLE,
  MODELO_IMAGEN_OPENAI,
  promptImagenIA,
  proveedorGeneraImagenes,
} from "@/lib/ia/imagen";
import type { ConexionIAConClave } from "@/lib/ia/tipos";

// Firma real de un PNG (8 bytes) + relleno: suficiente para tipoImagenPorMagicBytes.
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(32)]);

function conexion(proveedor: ConexionIAConClave["proveedor"]): ConexionIAConClave {
  return { id: "c1", proveedor, baseUrl: null, modelo: "texto", actualizadoTs: new Date(), apiKey: "clave-secreta" };
}

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("qué se le pide a la IA", () => {
  it("portada: mismo producto, fondo blanco, sin textos", () => {
    const p = promptImagenIA("portada", "Tijera ingletiadora", "");
    expect(p).toMatch(/fondo blanco puro/);
    expect(p).toMatch(/Sin textos/);
    expect(p).toMatch(/EXACTAMENTE el mismo producto/);
    expect(p).toContain("Tijera ingletiadora");
  });

  it("informativa: textos en español, sin inventar promociones; usa las indicaciones", () => {
    const p = promptImagenIA("informativa", null, "corta a 45°");
    expect(p).toMatch(/textos cortos en español/);
    expect(p).toMatch(/No inventes certificaciones/);
    expect(p).toContain("corta a 45°");
  });

  it("tipo e indicaciones con lista blanca y tope", () => {
    expect(leerTipoImagenIA("informativa")).toBe("informativa");
    expect(leerTipoImagenIA("otra")).toBe("portada");
    expect(limpiarIndicaciones("  a\n\nb  ")).toBe("a b");
    expect(limpiarIndicaciones("x".repeat(500))).toHaveLength(300);
    expect(limpiarIndicaciones(42)).toBe("");
  });

  it("solo OpenAI y Google generan imágenes", () => {
    expect(proveedorGeneraImagenes("openai")).toBe(true);
    expect(proveedorGeneraImagenes("google")).toBe(true);
    expect(proveedorGeneraImagenes("anthropic")).toBe(false);
    expect(proveedorGeneraImagenes("otro_compatible_openai")).toBe(false);
  });
});

describe("foto base", () => {
  it("solo de Mercado Libre (mlstatic) o de Cloudinary, por https", () => {
    expect(esUrlFotoBasePermitida("https://http2.mlstatic.com/D_123-O.jpg")).toBe(true);
    expect(esUrlFotoBasePermitida("https://res.cloudinary.com/zx/image/upload/a.png")).toBe(true);
    expect(esUrlFotoBasePermitida("https://evilmlstatic.com/a.jpg")).toBe(false);
    expect(esUrlFotoBasePermitida("http://http2.mlstatic.com/a.jpg")).toBe(false);
    expect(esUrlFotoBasePermitida("https://169.254.169.254/latest")).toBe(false);
  });

  it("rechaza un host no permitido sin descargar, y algo que no es imagen", async () => {
    const f = vi.fn();
    globalThis.fetch = f as unknown as typeof fetch;
    await expect(descargarFotoBase("https://evil.com/a.jpg")).rejects.toThrow(/no se puede usar/);
    expect(f).not.toHaveBeenCalled();
    f.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(descargarFotoBase("https://http2.mlstatic.com/a.jpg")).rejects.toThrow(/no es una imagen/);
    expect(f).toHaveBeenCalledWith("https://http2.mlstatic.com/a.jpg", expect.objectContaining({ redirect: "error" }));
  });

  it("descarga una foto real y detecta su tipo por la firma", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JPG, { status: 200 })) as unknown as typeof fetch;
    const r = await descargarFotoBase("https://http2.mlstatic.com/a.jpg");
    expect(r.tipo).toBe("image/jpeg");
  });
});

describe("generarImagenDesdeFoto", () => {
  const base = { buffer: JPG, tipo: "image/jpeg" as const };

  it("OpenAI: /v1/images/edits multipart con gpt-image y b64_json", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await generarImagenDesdeFoto(conexion("openai"), base, "prompt");
    expect(r.tipo).toBe("image/png");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer clave-secreta");
    const form = init.body as FormData;
    expect(form.get("model")).toBe(MODELO_IMAGEN_OPENAI);
    expect(form.get("prompt")).toBe("prompt");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("Google: generateContent con la foto en inline_data; lee inlineData de la respuesta", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "listo" }, { inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await generarImagenDesdeFoto(conexion("google"), base, "prompt");
    expect(r.tipo).toBe("image/png");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEN_GOOGLE}:generateContent`);
    expect(url).not.toContain("clave-secreta"); // la clave va en la cabecera, nunca en la URL (logs)
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("clave-secreta");
    const cuerpo = JSON.parse(init.body as string) as { contents: { parts: { inline_data?: { mime_type: string } }[] }[] };
    expect(cuerpo.contents[0].parts[1].inline_data?.mime_type).toBe("image/jpeg");
  });

  it("errores legibles: clave rechazada, sin imagen, proveedor que no genera, respuesta que no es imagen", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(generarImagenDesdeFoto(conexion("openai"), base, "p")).rejects.toThrow(/rechazó la clave/);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(generarImagenDesdeFoto(conexion("google"), base, "p")).rejects.toThrow(/no devolvió una imagen/);
    await expect(generarImagenDesdeFoto(conexion("anthropic"), base, "p")).rejects.toThrow(/no genera imágenes/);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("hola").toString("base64") }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(generarImagenDesdeFoto(conexion("openai"), base, "p")).rejects.toThrow(/no es una imagen válida/);
  });
});
