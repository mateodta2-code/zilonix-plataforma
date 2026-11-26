import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOMBRE_COOKIE_STATE } from "@/lib/mp/state-cookie";

// Issue #422 (Bloque 1) — mismo molde que app/api/ml/callback/route.test.ts:
// se mockea todo lo que la ruta toca para probar solo la validación
// (state, rechazo, permiso) sin base de datos ni Mercado Pago reales.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {
    constructor(modulo: string, accion: string) {
      super(`No tienes permiso para "${accion}" en "${modulo}".`);
      this.name = "SinPermisoError";
    }
  }
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/mp/cuentas", () => {
  class CuentaMpDeOtraEmpresaError extends Error {
    constructor() {
      super("Esta cuenta de Mercado Pago ya está conectada a otra empresa en Zilonix.");
      this.name = "CuentaMpDeOtraEmpresaError";
    }
  }
  return { guardarCuentaMpConectada: vi.fn(async () => ({ id: "cuenta-1" })), CuentaMpDeOtraEmpresaError };
});
vi.mock("@/lib/mp/oauth", () => ({
  intercambiarCodigo: vi.fn(async () => ({ accessToken: "tok", refreshToken: "ref", expiraEnSegundos: 15_552_000, cuentaIdExterna: "987" })),
  obtenerDatosUsuarioMp: vi.fn(async () => ({ nickname: "VENDEDOR_MP" })),
}));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { CuentaMpDeOtraEmpresaError, guardarCuentaMpConectada } from "@/lib/mp/cuentas";
import { intercambiarCodigo } from "@/lib/mp/oauth";
import { GET } from "./route";

function mockearCookies(valores: Record<string, string | undefined>) {
  vi.mocked(cookies).mockReturnValue({
    get: (nombre: string) => (valores[nombre] !== undefined ? { name: nombre, value: valores[nombre]! } : undefined),
  } as unknown as ReturnType<typeof cookies>);
}

function peticion(query: string): NextRequest {
  return new NextRequest(`https://staging.test/api/mp/callback?${query}`);
}

const STATE_REAL = "el-state-que-de-verdad-coincide";

describe("GET /api/mp/callback (issue #422, Bloque 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });

  it("state ausente en la cookie -> error=mp_estado_vencido, nunca canjea el code", async () => {
    mockearCookies({});
    const res = await GET(peticion("code=un-code&state=algo"));
    expect(res.headers.get("location")).toContain("error=mp_estado_vencido");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("state distinto (otra longitud) -> error=mp_estado_vencido, nunca canjea el code", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    const res = await GET(peticion("code=un-code&state=otro-state-distinto-y-mas-largo-que-el-real"));
    expect(res.headers.get("location")).toContain("error=mp_estado_vencido");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("state de la misma longitud pero distinto -> error=mp_estado_vencido", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: "a".repeat(43) });
    const res = await GET(peticion(`code=un-code&state=${"b".repeat(43)}`));
    expect(res.headers.get("location")).toContain("error=mp_estado_vencido");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("state correcto -> canjea el code, guarda la cuenta y redirige a conectado_mp=1", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    const res = await GET(peticion(`code=un-code&state=${STATE_REAL}`));
    expect(res.headers.get("location")).toBe("https://staging.test/panel/conectar-ml?conectado_mp=1");
    expect(intercambiarCodigo).toHaveBeenCalledWith("un-code");
    expect(guardarCuentaMpConectada).toHaveBeenCalledWith("empresa-1", expect.objectContaining({ cuentaIdExterna: "987", nickname: "VENDEDOR_MP" }));
  });

  it("Mercado Pago vuelve con ?error= -> error=mp_rechazo, nunca refleja el valor", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    const res = await GET(peticion("error=access_denied%20%3Cscript%3E"));
    const location = decodeURIComponent(res.headers.get("location") ?? "");
    expect(location).toContain("error=mp_rechazo");
    expect(location).not.toContain("access_denied");
    expect(location).not.toContain("<script>");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("sin code -> error=mp_rechazo", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    const res = await GET(peticion(`state=${STATE_REAL}`));
    expect(res.headers.get("location")).toContain("error=mp_rechazo");
  });

  it("sin permiso (SinPermisoError) -> error=mp_sin_permiso, nunca canjea el code", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    vi.mocked(requierePermiso).mockRejectedValue(new SinPermisoError("configuracion", "crear"));
    const res = await GET(peticion(`code=un-code&state=${STATE_REAL}`));
    expect(res.headers.get("location")).toContain("error=mp_sin_permiso");
    expect(requierePermiso).toHaveBeenCalledWith("usuario-1", "empresa-1", "configuracion", "crear");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  it("cuenta ya conectada a otra empresa -> error=mp_cuenta_en_otra_empresa", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    vi.mocked(guardarCuentaMpConectada).mockRejectedValue(new CuentaMpDeOtraEmpresaError());
    const res = await GET(peticion(`code=un-code&state=${STATE_REAL}`));
    expect(res.headers.get("location")).toContain("error=mp_cuenta_en_otra_empresa");
  });

  it("cualquier otro error -> error=mp_error_desconocido, nunca el mensaje crudo", async () => {
    mockearCookies({ [NOMBRE_COOKIE_STATE]: STATE_REAL });
    vi.mocked(intercambiarCodigo).mockRejectedValue(new Error("Mercado Pago respondió 500: <cuerpo crudo secreto>"));
    const res = await GET(peticion(`code=un-code&state=${STATE_REAL}`));
    const location = decodeURIComponent(res.headers.get("location") ?? "");
    expect(location).toContain("error=mp_error_desconocido");
    expect(location).not.toContain("cuerpo crudo secreto");
  });

  it("borra el state con el MISMO path con el que se puso (Path=/api/mp, Max-Age=0)", async () => {
    mockearCookies({});
    const res = await GET(peticion("code=un-code&state=algo"));
    const cookieState = res.headers.getSetCookie().find((c) => c.startsWith(`${NOMBRE_COOKIE_STATE}=`));
    expect(cookieState, "no se mandó ningún Set-Cookie para el state").toBeDefined();
    expect(cookieState).toContain("Path=/api/mp");
    expect(cookieState).toContain("Max-Age=0");
  });
});
