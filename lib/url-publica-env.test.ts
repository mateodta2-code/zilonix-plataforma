import { describe, expect, it } from "vitest";
import { urlPublicaDesdeEnv } from "./url-publica-env";

describe("urlPublicaDesdeEnv (dominio único seller.zilonix.com)", () => {
  it("sin variables devuelve null (se usa RAILWAY_PUBLIC_DOMAIN como antes)", () => {
    expect(urlPublicaDesdeEnv({})).toBeNull();
    expect(urlPublicaDesdeEnv({ APP_URL: "  " })).toBeNull();
  });
  it("APP_URL manda sobre PUBLIC_APP_URL y NEXT_PUBLIC_APP_URL", () => {
    const env = { APP_URL: "https://seller.zilonix.com", PUBLIC_APP_URL: "https://otro.test", NEXT_PUBLIC_APP_URL: "https://x.test" };
    expect(urlPublicaDesdeEnv(env)).toBe("https://seller.zilonix.com");
  });
  it("usa los respaldos en orden, quita la barra final y completa https", () => {
    expect(urlPublicaDesdeEnv({ PUBLIC_APP_URL: "https://a.test/" })).toBe("https://a.test");
    expect(urlPublicaDesdeEnv({ NEXT_PUBLIC_APP_URL: "seller.zilonix.com" })).toBe("https://seller.zilonix.com");
  });
});
