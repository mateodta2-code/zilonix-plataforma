import { describe, expect, it } from "vitest";
import { INTERRUPTORES_EXTENSION, URL_APP_PRODUCCION } from "@/lib/extension/configuracion";
import { GET } from "./route";

describe("GET /api/extension/config (issue #414)", () => {
  it("responde sin sesión, sin caché, con Alibaba apagado y producción en seller.zilonix.com", async () => {
    const r = await GET();
    expect(r.status).toBe(200);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    const j = await r.json();
    expect(j.version).toBe(1);
    expect(j.interruptores).toEqual({ alibaba: false });
    expect(j.textos.avisoSinSesion).toBeTruthy();
    expect(typeof j.urlApp).toBe("string");
    expect(URL_APP_PRODUCCION).toBe("https://seller.zilonix.com");
  });

  it("el interruptor de Alibaba está apagado por defecto (está en pausa)", () => {
    expect(INTERRUPTORES_EXTENSION.alibaba).toBe(false);
  });
});
