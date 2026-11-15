import { randomBytes } from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOMBRE_COOKIE_STATE, NOMBRE_COOKIE_VERIFIER } from "@/lib/ml/pkce-cookie";
import { NOMBRE_COOKIE_TRANSFERENCIA } from "@/lib/ml/transferencia-cookie";

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
vi.mock("@/lib/ml/cuentas", () => {
  class CuentaMlDeOtraEmpresaError extends Error {
    constructor() {
      super("Esta cuenta de Mercado Libre ya está conectada a otra empresa en Zilonix. Desconéctala allá primero o escríbenos a soporte.");
      this.name = "CuentaMlDeOtraEmpresaError";
    }
  }
  return { guardarCuentaConectada: vi.fn(async () => ({ id: "cuenta-1" })), CuentaMlDeOtraEmpresaError };
});
vi.mock("@/lib/ml/oauth", () => ({
  intercambiarCodigo: vi.fn(async () => ({ accessToken: "tok", refreshToken: "ref", expiraEnSegundos: 21600, cuentaIdExterna: "123" })),
  // Issue #315 (Z-LATAM-01) — antes "obtenerNickname" devolvía solo el
  // string; ahora devuelve también el site_id real de /users/me.
  obtenerDatosVendedorMl: vi.fn(async () => ({ nickname: "VENDEDOR_TEST", siteId: "MCO" })),
}));
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));
vi.mock("@/lib/ml/importacion", () => ({ ejecutarImportacionInicial: vi.fn(async () => {}) }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { CuentaMlDeOtraEmpresaError, guardarCuentaConectada } from "@/lib/ml/cuentas";
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
    // @/lib/ml/transferencia-cookie (issue #181) no se mockea — usa el
    // cifrado real (lib/cifrado.ts), que necesita esta variable.
    process.env.ML_TOKEN_KEY_V1 = randomBytes(32).toString("base64");
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

  // Issue #315 (Z-LATAM-01) — el site_id real que trae /users/me
  // (vía obtenerDatosVendedorMl) tiene que llegar hasta
  // guardarCuentaConectada, nunca perderse en el camino.
  it("el site_id real de /users/me viaja hasta guardarCuentaConectada", async () => {
    const stateReal = "el-state-que-de-verdad-coincide";
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real", [NOMBRE_COOKIE_STATE]: stateReal });
    await GET(peticion(`code=un-code&state=${stateReal}`));
    expect(guardarCuentaConectada).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ siteId: "MCO", nickname: "VENDEDOR_TEST" })
    );
  });

  // Bug real: antes iba error.message tal cual a la URL — mismo molde
  // que para CUALQUIER otro error de esta ruta terminaba mandando a la
  // pantalla texto crudo de Mercado Libre o de Postgres. Ahora todo es
  // uno de 5 códigos fijos — page.tsx traduce el código, nunca texto libre.
  it("sin permiso (SinPermisoError) -> redirige a /panel/conectar-ml con el código fijo sin_permiso, nunca revienta", async () => {
    mockearCookies({});
    vi.mocked(requierePermiso).mockRejectedValue(new SinPermisoError("configuracion", "crear"));
    const res = await GET(peticion("code=un-code&state=algo"));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/panel/conectar-ml");
    expect(location).toContain("error=sin_permiso");
    expect(intercambiarCodigo).not.toHaveBeenCalled();
  });

  // Issue #181 — en vez de solo avisar "ya está conectada a otra
  // empresa", ahora se ofrece transferirla: redirige a la pantalla de
  // confirmación, con los tokens nuevos viajando SOLO en una cookie
  // httpOnly cifrada — nunca en la URL ni en texto plano en ningún Set-Cookie.
  it("guardarCuentaConectada lanza CuentaMlDeOtraEmpresaError -> redirige a confirmar-transferencia, con los tokens en una cookie httpOnly cifrada", async () => {
    const stateReal = "el-state-que-de-verdad-coincide";
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real", [NOMBRE_COOKIE_STATE]: stateReal });
    vi.mocked(guardarCuentaConectada).mockRejectedValue(new CuentaMlDeOtraEmpresaError());
    const res = await GET(peticion(`code=un-code&state=${stateReal}`));
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("https://staging.test/panel/conectar-ml/confirmar-transferencia");

    const setCookies = res.headers.getSetCookie();
    const cookiePendiente = setCookies.find((c) => c.startsWith(`${NOMBRE_COOKIE_TRANSFERENCIA}=`));
    expect(cookiePendiente, "no se mandó ningún Set-Cookie con el pendiente de transferencia").toBeDefined();
    expect(cookiePendiente).toContain("HttpOnly");
    expect(cookiePendiente).toContain("Path=/panel/conectar-ml");
    // Nunca el nickname real tal cual (ver el mock de obtenerNickname
    // arriba) en ningún header de la respuesta — tiene que viajar
    // cifrado, no en texto plano.
    expect([...res.headers.values()].join(" ")).not.toContain("VENDEDOR_TEST");
  });

  // Cualquier OTRA falla (ML rechazó el canje, Postgres, lo que sea) —
  // nunca el texto crudo de esa falla en la URL, cae en el código
  // genérico. oauth.ts documenta que ese texto puede traer hasta 300
  // caracteres de la respuesta cruda de Mercado Libre.
  it("guardarCuentaConectada lanza cualquier otro error -> redirige con error=error_desconocido, nunca el mensaje crudo", async () => {
    const stateReal = "el-state-que-de-verdad-coincide";
    mockearCookies({ [NOMBRE_COOKIE_VERIFIER]: "un-verifier-real", [NOMBRE_COOKIE_STATE]: stateReal });
    vi.mocked(guardarCuentaConectada).mockRejectedValue(new Error("Mercado Libre respondió 500 al pedir el token: <cuerpo crudo secreto>"));
    const res = await GET(peticion(`code=un-code&state=${stateReal}`));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("error=error_desconocido");
    expect(decodeURIComponent(location)).not.toContain("cuerpo crudo secreto");
  });

  // El vendedor cancela o Mercado Libre rechaza en su propia pantalla —
  // ?error= llega como query param de la URL (texto que no controlamos
  // nosotros): nunca se refleja tal cual, siempre el código fijo.
  it("Mercado Libre vuelve con su propio ?error= -> redirige con error=ml_rechazo, nunca refleja el valor de la URL", async () => {
    mockearCookies({});
    const res = await GET(peticion("error=access_denied%20%3Cscript%3E"));
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("error=ml_rechazo");
    expect(decodeURIComponent(location)).not.toContain("access_denied");
    expect(decodeURIComponent(location)).not.toContain("<script>");
  });

  it("borra el verifier y el state con el MISMO path con el que se pusieron (Path=/api/ml, Max-Age=0) — si no, el navegador nunca los borra de verdad", async () => {
    mockearCookies({}); // cualquier salida por volver() alcanza para probar esto
    const res = await GET(peticion("code=un-code&state=algo"));
    const setCookies = res.headers.getSetCookie();
    const cookieVerifier = setCookies.find((c) => c.startsWith(`${NOMBRE_COOKIE_VERIFIER}=`));
    const cookieState = setCookies.find((c) => c.startsWith(`${NOMBRE_COOKIE_STATE}=`));
    expect(cookieVerifier, "no se mandó ningún Set-Cookie para el verifier").toBeDefined();
    expect(cookieState, "no se mandó ningún Set-Cookie para el state").toBeDefined();
    for (const cookie of [cookieVerifier!, cookieState!]) {
      expect(cookie).toContain("Path=/api/ml");
      expect(cookie).toContain("Max-Age=0");
    }
  });
});
