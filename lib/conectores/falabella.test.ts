import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "crypto";

// Sin base de datos: la verificación de la clave tiene que cortar ANTES
// de guardar, así que el guardado se reemplaza por un doble.
vi.mock("@/lib/falabella/cuentas", () => ({ guardarCuentaConectada: vi.fn().mockResolvedValue({ id: "cuenta-1" }) }));
vi.mock("@/lib/falabella/pedidos", () => ({}));

import { ConectorFalabella } from "./falabella";
import { ClaveCifradoError } from "@/lib/cifrado";

// Issue #422: con FALABELLA_TOKEN_KEY_V1 ausente o inválida, conectar()
// fallaba recién al guardar y la pantalla le pedía al comercio revisar
// su UserID/API Key. Ahora se revisa antes de llamar a Falabella.
describe("ConectorFalabella.conectar — clave de cifrado (issue #422)", () => {
  const datos = { userId: "a@b.com", apiKey: "clave", sellerId: "SC0170C", nickname: "Tienda" };
  const claveOriginal = process.env.FALABELLA_TOKEN_KEY_V1;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ SuccessResponse: { Body: {} } }), { status: 200 })));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (claveOriginal === undefined) delete process.env.FALABELLA_TOKEN_KEY_V1;
    else process.env.FALABELLA_TOKEN_KEY_V1 = claveOriginal;
  });

  it("sin FALABELLA_TOKEN_KEY_V1 lanza ClaveCifradoError y no llama a Falabella", async () => {
    delete process.env.FALABELLA_TOKEN_KEY_V1;
    await expect(new ConectorFalabella("empresa-1").conectar(datos)).rejects.toBeInstanceOf(ClaveCifradoError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("con una clave inválida (no son 32 bytes) lanza ClaveCifradoError y no llama a Falabella", async () => {
    process.env.FALABELLA_TOKEN_KEY_V1 = randomBytes(16).toString("base64");
    await expect(new ConectorFalabella("empresa-1").conectar(datos)).rejects.toBeInstanceOf(ClaveCifradoError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("con una clave válida sí llama a Falabella para verificar las credenciales", async () => {
    process.env.FALABELLA_TOKEN_KEY_V1 = randomBytes(32).toString("base64");
    await expect(new ConectorFalabella("empresa-1").conectar(datos)).resolves.toEqual({ cuentaIdExterna: "a@b.com", nickname: "Tienda" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
