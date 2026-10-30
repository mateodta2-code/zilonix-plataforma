import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mismo patrón que app/api/ml/promociones/candidatos/route.test.ts —
// se mockean sesión/empresa/permisos y, acá, directamente el módulo
// que toca Mercado Libre (lib/ml/promocionesParticipando, que ya tiene
// su propio test con mocks de ML/Postgres) — esta ruta solo orquesta
// "una llamada por cuenta conectada", así que es lo único que hace
// falta probar acá.
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

const { listarCuentasConectadasMock } = vi.hoisted(() => ({ listarCuentasConectadasMock: vi.fn() }));
vi.mock("@/lib/ml/cuentas", () => ({ listarCuentasConectadas: listarCuentasConectadasMock }));

const { listarParticipandoCuentaMock } = vi.hoisted(() => ({ listarParticipandoCuentaMock: vi.fn() }));
vi.mock("@/lib/ml/promocionesParticipando", () => ({ listarParticipandoCuenta: listarParticipandoCuentaMock }));

import { cookies } from "next/headers";
import { requierePermiso } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { GET } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

describe("GET /api/ml/promociones/participando — rama fix-promociones-aprobadas-participando, punto 3", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("junta las filas de TODAS las cuentas conectadas y les pone el nickname real", async () => {
    listarCuentasConectadasMock.mockResolvedValue([
      { id: "cuenta-1", nickname: "Cuenta Uno", desconectadaTs: null },
      { id: "cuenta-2", nickname: "Cuenta Dos", desconectadaTs: null },
    ]);
    listarParticipandoCuentaMock.mockImplementation(async (_empresaId: string, cuentaId: string) =>
      cuentaId === "cuenta-1" ? [{ itemId: "MCO1", cuentaMlId: "cuenta-1" }] : [{ itemId: "MCO2", cuentaMlId: "cuenta-2" }]
    );

    const res = await GET(new Request("https://staging.test/api/ml/promociones/participando"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(2);
    expect(body.filas.find((f: { itemId: string }) => f.itemId === "MCO1").nicknameCuenta).toBe("Cuenta Uno");
    expect(body.filas.find((f: { itemId: string }) => f.itemId === "MCO2").nicknameCuenta).toBe("Cuenta Dos");
  });

  it("filtra por cuentaId cuando se manda", async () => {
    const cuentaUuid = "11111111-1111-1111-1111-111111111111";
    listarCuentasConectadasMock.mockResolvedValue([
      { id: cuentaUuid, nickname: "Cuenta Uno", desconectadaTs: null },
      { id: "22222222-2222-2222-2222-222222222222", nickname: "Cuenta Dos", desconectadaTs: null },
    ]);
    listarParticipandoCuentaMock.mockResolvedValue([{ itemId: "MCO1", cuentaMlId: cuentaUuid }]);

    const res = await GET(new Request(`https://staging.test/api/ml/promociones/participando?cuentaId=${cuentaUuid}`));
    expect(listarParticipandoCuentaMock).toHaveBeenCalledTimes(1);
    expect(listarParticipandoCuentaMock).toHaveBeenCalledWith("empresa-1", cuentaUuid);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(1);
  });

  it("cuentaId con formato inválido: 400", async () => {
    const res = await GET(new Request("https://staging.test/api/ml/promociones/participando?cuentaId=no-es-un-uuid"));
    expect(res.status).toBe(400);
  });

  it("una cuenta que falla (token vencido, etc.) se omite — las demás siguen viéndose", async () => {
    listarCuentasConectadasMock.mockResolvedValue([
      { id: "cuenta-1", nickname: "Cuenta Uno", desconectadaTs: null },
      { id: "cuenta-2", nickname: "Cuenta Dos", desconectadaTs: null },
    ]);
    listarParticipandoCuentaMock.mockImplementation(async (_empresaId: string, cuentaId: string) => {
      if (cuentaId === "cuenta-1") throw new Error("token vencido");
      return [{ itemId: "MCO2", cuentaMlId: "cuenta-2" }];
    });

    const res = await GET(new Request("https://staging.test/api/ml/promociones/participando"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(1);
    expect(body.filas[0].itemId).toBe("MCO2");
  });
});
