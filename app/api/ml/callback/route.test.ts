import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/ml/pkce-cookie";

// Fix real (2026-10-21) — state (RFC 6749 §10.12, protección CSRF):
// sin esto, alguien podía armar su propio link de autorización con SU
// code_challenge y hacer que la víctima lo abriera, conectando sin
// saberlo la cuenta de Mercado Libre del atacante a la empresa de la
// víctima. Estas pruebas cubren justo esos tres casos — ausente,
// distinto, correcto — mockeando todo lo que esta ruta toca para poder
// probar SOLO la validación del state, sin una base de datos ni
// Mercado Libre reales.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
// No se usa vi.importActual acá: lib/permisos.ts importa (transitivo)
// db/index.ts, que revienta sin DATABASE_URL_APP. Se redefine
// SinPermisoError con la misma forma real (mismo constructor, mismo
// mensaje) — route.ts la importa de este mismo módulo mockeado, así
// que el "instanceof" sigue funcionando exactamente igual.
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/ml/cuentas", () => ({ guardarCuentaConectada: vi.fn(async () => ({ id: "cuenta-1" })) }));
vi.mock("@/lib/ml/oauth", () => ({
  intercambiarCodigo: vi.fn(async () => ({ accessToken: "tok", refreshToken: "ref", expiraEnSegundos: 21600, cuentaIdExterna: "123" })),
  obtenerNickname: vi.fn(async () => "VENDEDOR_TEST"),
}));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));
vi.mock("@/lib/ml/importacion", () => ({ ejecutarImportacionInicial: vi.fn(async () => {}) }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { intercambiarCodigo } from "@/lib/ml/oauth";
import { GET } from "./route";

function mockearCookies(valores: Record<string, string | undefined>) {
  vi.mocked(cookies).mockReturnValue({
    get: (nombre: string) => (valores[nombre] !== undefined ? { name: nombre, value: valores[nombre]! } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

function peticion(query: string): NextRequest {
  return new NextRequest(`https://staging.test/api/ml/callback?${query}`);
}

describe("GET /api/ml/callback — validación de state (fix middleware, 2026-10-21)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });

  it("state ausente en la cookie -> redirige con error, nunca canjea el code", async () => {
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real" }); // sin NOMBRE_COOKIE_STATE
    const res = await GET(peticion("code=un-code&state=lo-que-mando-ml"));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/conectar-ml");
    expect(location).toContain("error=");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("state distinto entre la cookie y el query param -> redirige con error, nunca canjea el code", async () => {
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real", [NOMBRE_COOKIE_STATE]: "el-state-real" });
    const res = await GET(peticion("code=un-code&state=un-state-distinto-y-mas-largo-que-el-real"));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/conectar-ml");
    expect(location).toContain("error=");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("state de la misma longitud pero distinto -> también redirige con error (nunca pasa por timingSafeEqual con buffers de largo distinto)", async () => {
    const stateReal = "a".repeat(43);
    const stateFalso = "b".repeat(43);
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real", [NOMBRE_COOKIE_STATE]: stateReal });
    const res = await GET(peticion(`code=un-code&state=${stateFalso}`));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("error=");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("state correcto (coincide con la cookie) -> canjea el code y redirige a conectado=1", async () => {
    const stateReal = "el-state-que-de-verdad-coincide";
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real", [NOMBRE_COOKIE_STATE]: stateReal });
    const res = await GET(peticion(`code=un-code&state=${stateReal}`));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("conectado=1");
    expect(intercambiarCodigo).toHaveBeenCalledWith("un-code", "https://staging.test/api/ml/callback", "un-verifier-real");
  });

  it("sin permiso (SinPermisoError) -> redirige a /panel/conectar-ml con el mensaje, nunca revienta", async () => {
    mockearCookies({});
    vi.mocked(requierePermiso).mockRejectedValue(new SinPermisoError("configuracion", "crear"));
    const res = await GET(peticion("code=un-code&state=algo"));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/conectar-ml");
    expect(decodeURIComponent(location)).toContain("No tienes permiso");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });
});
