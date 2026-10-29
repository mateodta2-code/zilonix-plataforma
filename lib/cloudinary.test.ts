import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloudinaryConfigurado, CloudinaryNoConfiguradoError, CloudinaryRechazoError, subirACloudinary } from "./cloudinary";

function respuestaJson(data: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => data } as Response;
}

describe("cloudinaryConfigurado", () => {
  afterEach(() => {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  it("false si falta cualquiera de las 3 variables", () => {
    expect(cloudinaryConfigurado()).toBe(false);
    process.env.CLOUDINARY_CLOUD_NAME = "x";
    expect(cloudinaryConfigurado()).toBe(false);
    process.env.CLOUDINARY_API_KEY = "y";
    expect(cloudinaryConfigurado()).toBe(false);
  });

  it("true solo con las 3 presentes", () => {
    process.env.CLOUDINARY_CLOUD_NAME = "x";
    process.env.CLOUDINARY_API_KEY = "y";
    process.env.CLOUDINARY_API_SECRET = "z";
    expect(cloudinaryConfigurado()).toBe(true);
  });
});

describe("subirACloudinary", () => {
  beforeEach(() => {
    process.env.CLOUDINARY_CLOUD_NAME = "demo";
    process.env.CLOUDINARY_API_KEY = "123";
    process.env.CLOUDINARY_API_SECRET = "secreto";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
  });

  it("sin las 3 variables: CloudinaryNoConfiguradoError, nunca llama a fetch", async () => {
    delete process.env.CLOUDINARY_API_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(subirACloudinary(Buffer.from("x"), "foto.jpg", "image/jpeg")).rejects.toThrow(CloudinaryNoConfiguradoError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("éxito: manda resource_type image, transformación q_auto/w_1600/c_limit, el api_secret NUNCA va en el form (solo la firma)", async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.cloudinary.com/v1_1/demo/image/upload");
      const form = init?.body as FormData;
      expect(form.get("transformation")).toBe("q_auto,w_1600,c_limit");
      expect(form.get("folder")).toBe("zilonix-plataforma");
      expect(form.get("api_key")).toBe("123");
      // El secreto nunca viaja en el form — solo participó en el hash de "signature".
      for (const [, valor] of form.entries()) {
        expect(String(valor)).not.toContain("secreto");
      }
      expect(typeof form.get("signature")).toBe("string");
      return respuestaJson({ secure_url: "https://res.cloudinary.com/demo/image/upload/foto.jpg" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await subirACloudinary(Buffer.from("x"), "foto.jpg", "image/jpeg");
    expect(r).toEqual({ url: "https://res.cloudinary.com/demo/image/upload/foto.jpg" });
  });

  it("Cloudinary rechaza la subida: CloudinaryRechazoError con el detalle real", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => respuestaJson({ error: { message: "Invalid image file" } }, 400)));
    await expect(subirACloudinary(Buffer.from("x"), "foto.jpg", "image/jpeg")).rejects.toThrow(/Invalid image file/);
  });

  it("respuesta sin JSON válido: CloudinaryRechazoError genérico, nunca lanza una excepción sin capturar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => { throw new Error("no json"); } }) as unknown as Response)
    );
    await expect(subirACloudinary(Buffer.from("x"), "foto.jpg", "image/jpeg")).rejects.toThrow(CloudinaryRechazoError);
  });
});
