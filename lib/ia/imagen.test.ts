import { afterEach, describe, expect, it, vi } from "vitest";
import {
  descargarFotoBase,
  esUrlFotoBasePermitida,
  generarImagenDesdeFoto,
  COMPOSICIONES_PORTADA,
  leerTipoImagenIA,
  leerVariante,
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
  return { id: "c1", nombre: "IA", esPrincipal: true, proveedor, baseUrl: null, modelo: "texto", actualizadoTs: new Date(), apiKey: "clave-secreta" };
}

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

describe("qué se le pide a la IA", () => {
  it("portada de venta: mismo producto, fondo blanco, escena de uso, lo que incluye, sin textos", () => {
    const p = promptImagenIA("portada", "Tijera ingletiadora", "incluye 2 cuchillas de repuesto");
    expect(p).toMatch(/blanco puro #FFFFFF/);
    expect(p).toMatch(/PROHIBIDO: textos/);
    expect(p).toMatch(/afirmaciones de salud/);
    expect(p).toMatch(/EXACTAMENTE el mismo producto/);
    expect(p).toMatch(/escena secundaria real/);
    expect(p).toMatch(/no agregues nada que no esté incluido/);
    expect(p).toContain("Tijera ingletiadora");
    expect(p).toContain("incluye 2 cuchillas de repuesto");
  });

  it("cada variante de portada pide otra composición (10 distintas)", () => {
    expect(new Set(COMPOSICIONES_PORTADA).size).toBe(10);
    const prompts = COMPOSICIONES_PORTADA.map((_, i) => promptImagenIA("portada", null, "", i));
    expect(new Set(prompts).size).toBe(10);
    expect(prompts[3]).toContain(COMPOSICIONES_PORTADA[3]);
    expect(leerVariante(12)).toBe(2);
    expect(leerVariante(-1)).toBe(0);
    expect(leerVariante("3")).toBe(0);
  });

  it("la informativa no sale de acá: necesita su contenido aprobado", () => {
    expect(() => promptImagenIA("informativa", null, "corta a 45°")).toThrow(/contenido aprobado/);
  });

  it("tipo e indicaciones con lista blanca y tope", () => {
    expect(leerTipoImagenIA("informativa")).toBe("informativa");
    expect(leerTipoImagenIA("otra")).toBe("portada");
    expect(limpiarIndicaciones("  a\n\nb  ")).toBe("a b");
    expect(limpiarIndicaciones("x".repeat(2000))).toHaveLength(1500);
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
    const r = await generarImagenDesdeFoto(conexion("openai"), [base], "prompt");
    expect(r.tipo).toBe("image/png");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer clave-secreta");
    const form = init.body as FormData;
    expect(form.get("model")).toBe(MODELO_IMAGEN_OPENAI);
    expect(form.get("prompt")).toBe("prompt");
    expect(form.get("image")).toBeInstanceOf(Blob);
  });

  it("OpenAI con varias fotos de referencia: image[] (máximo 3)", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: PNG.toString("base64") }] }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    await generarImagenDesdeFoto(conexion("openai"), [base, base, base, base], "prompt");
    const form = (f.mock.calls[0] as [string, RequestInit])[1].body as FormData;
    expect(form.getAll("image[]")).toHaveLength(3);
    expect(form.get("image")).toBeNull();
  });

  it("Google: generateContent con la foto en inline_data; lee inlineData de la respuesta", async () => {
    const f = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "listo" }, { inlineData: { mimeType: "image/png", data: PNG.toString("base64") } }] } }] }), { status: 200 }));
    globalThis.fetch = f as unknown as typeof fetch;
    const r = await generarImagenDesdeFoto(conexion("google"), [base, base], "prompt");
    expect(r.tipo).toBe("image/png");
    const [url, init] = f.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_IMAGEN_GOOGLE}:generateContent`);
    expect(url).not.toContain("clave-secreta"); // la clave va en la cabecera, nunca en la URL (logs)
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("clave-secreta");
    const cuerpo = JSON.parse(init.body as string) as { contents: { parts: { inline_data?: { mime_type: string } }[] }[] };
    expect(cuerpo.contents[0].parts[1].inline_data?.mime_type).toBe("image/jpeg");
    expect(cuerpo.contents[0].parts).toHaveLength(3);
  });

  it("OpenAI 400/403: dice el motivo real (filtro, verificación, foto, saldo) sin mostrar el texto crudo", async () => {
    const respuesta = (status: number, error: Record<string, string>) =>
      (globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error }), { status })) as unknown as typeof fetch);
    respuesta(400, { code: "moderation_blocked", type: "image_generation_user_error", message: "Your request was rejected by the safety system. prompt secreto" });
    await expect(generarImagenDesdeFoto(conexion("openai"), [base], "p")).rejects.toThrow(/filtro de contenido/);
    respuesta(403, { code: "", type: "invalid_request_error", message: "Your organization must be verified to use the model gpt-image-1." });
    await expect(generarImagenDesdeFoto(conexion("openai"), [base], "p")).rejects.toThrow(/verificar la organización/);
    respuesta(400, { code: "invalid_image_format", type: "invalid_request_error", message: "Invalid image file" });
    await expect(generarImagenDesdeFoto(conexion("openai"), [base], "p")).rejects.toThrow(/no pudo leer la foto base/);
    respuesta(429, { code: "insufficient_quota", type: "insufficient_quota", message: "You exceeded your current quota" });
    await expect(generarImagenDesdeFoto(conexion("openai"), [base], "p")).rejects.toThrow(/saldo/);
    respuesta(400, { code: "otro_codigo", type: "invalid_request_error", message: "algo con prompt secreto" });
    const error = await generarImagenDesdeFoto(conexion("openai"), [base], "p").catch((e: Error) => e);
    expect(String(error)).toMatch(/código: otro_codigo/);
    expect(String(error)).not.toMatch(/secreto/);
  });

  it("errores legibles: clave rechazada, sin imagen, proveedor que no genera, respuesta que no es imagen", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 401 })) as unknown as typeof fetch;
    await expect(generarImagenDesdeFoto(conexion("openai"), [base], "p")).rejects.toThrow(/rechazó la clave/);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "no" }] } }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(generarImagenDesdeFoto(conexion("google"), [base], "p")).rejects.toThrow(/no devolvió una imagen/);
    await expect(generarImagenDesdeFoto(conexion("anthropic"), [base], "p")).rejects.toThrow(/no genera imágenes/);
    await expect(generarImagenDesdeFoto(conexion("openai"), [], "p")).rejects.toThrow(/Falta la foto base/);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("hola").toString("base64") }] }), { status: 200 })) as unknown as typeof fetch;
    await expect(generarImagenDesdeFoto(conexion("openai"), [base], "p")).rejects.toThrow(/no es una imagen válida/);
  });
});
