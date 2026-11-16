import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Bug real en staging: detrás del proxy de Railway req.url trae el host
// interno (localhost:8080). Las redirecciones deben ir al dominio público.
vi.mock("next/headers", () => ({ headers: () => new Headers({ host: "localhost:8080" }) }));
const evaluar = vi.fn();
vi.mock("@/lib/superadmin", () => ({ evaluarAccesoSuperadmin: () => evaluar(), RUTA_LOGIN_SUPERADMIN: "/superadmin/iniciar-sesion" }));
vi.mock("@/lib/superadmin-sesion", () => ({
  NOMBRE_COOKIE_SUPERADMIN: "zx_superadmin",
  firmarCookieSuperadmin: vi.fn(async () => "firmada"),
  opcionesCookieSuperadmin: () => ({ httpOnly: true }),
}));

describe("GET /superadmin/entrar — redirecciones con la base pública", () => {
  const envOriginal = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envOriginal, RAILWAY_PUBLIC_DOMAIN: "staging.zilonix.test", SUPERADMIN_SESION_SECRETO: "s" };
    delete process.env.APP_URL;
    delete process.env.PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_APP_URL;
  });
  afterEach(() => {
    process.env = { ...envOriginal };
  });

  it("acceso concedido: redirige a /superadmin en el dominio público, no en localhost:8080", async () => {
    evaluar.mockResolvedValue({ ok: true, clerkUserId: "u1" });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost:8080/superadmin/entrar"));
    expect(res.headers.get("location")).toBe("https://staging.zilonix.test/superadmin");
  });

  it("acceso denegado: redirige al login en el dominio público", async () => {
    evaluar.mockResolvedValue({ ok: false, motivo: "no-superadmin" });
    const { GET } = await import("./route");
    const res = await GET(new NextRequest("http://localhost:8080/superadmin/entrar"));
    expect(res.headers.get("location")).toBe("https://staging.zilonix.test/superadmin/iniciar-sesion?motivo=no-superadmin");
  });
});
