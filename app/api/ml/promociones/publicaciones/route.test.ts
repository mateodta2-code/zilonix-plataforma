import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mismo patrón que .../participando/route.test.ts — esta ruta solo
// valida parámetros y orquesta; lib/ml/promocionesPublicaciones.ts ya
// tiene su propio test con mocks de ML/Postgres.
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

const { listarPublicacionesConEstadoMock } = vi.hoisted(() => ({
  listarPublicacionesConEstadoMock: vi.fn(async () => ({ filas: [], conteosLote: { todas: 0, enPromocion: 0, sinPromocion: 0, conError: 0 }, cursorSiguiente: null })),
}));
vi.mock("@/lib/ml/promocionesPublicaciones", () => ({ listarPublicacionesConEstado: listarPublicacionesConEstadoMock }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { GET } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(query = ""): Request {
  return new Request(`https://staging.test/api/ml/promociones/publicaciones${query}`);
}

describe("GET /api/ml/promociones/publicaciones — Tarea Promociones real (Refs #295)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("caso feliz: pasa los parámetros tal cual al módulo real", async () => {
    const res = await GET(peticion("?cuentaId=todas&filtro=en-promocion&buscar=camisa&cursor=abc&tamanoPagina=30"));
    expect(res.status).toBe(200);
    expect(listarPublicacionesConEstadoMock).toHaveBeenCalledWith("empresa-1", {
      cuentaId: "todas",
      filtro: "en-promocion",
      buscar: "camisa",
      cursor: "abc",
      tamanoPagina: 30,
    });
  });

  it("sin parámetros: usa los valores por defecto (todas/todas/sin buscar/tamaño 20)", async () => {
    await GET(peticion());
    expect(listarPublicacionesConEstadoMock).toHaveBeenCalledWith("empresa-1", { cuentaId: "todas", filtro: "todas", buscar: "", cursor: null, tamanoPagina: 20 });
  });

  it("cuentaId inválido (ni 'todas' ni un UUID): 400, nunca llega al módulo", async () => {
    const res = await GET(peticion("?cuentaId=no-es-un-uuid"));
    expect(res.status).toBe(400);
    expect(listarPublicacionesConEstadoMock).not.toHaveBeenCalled();
  });

  it("filtro inválido: 400", async () => {
    const res = await GET(peticion("?filtro=lo-que-sea"));
    expect(res.status).toBe(400);
    expect(listarPublicacionesConEstadoMock).not.toHaveBeenCalled();
  });

  it("tamanoPagina por encima del tope se recorta al máximo permitido", async () => {
    await GET(peticion("?tamanoPagina=9999"));
    expect(listarPublicacionesConEstadoMock).toHaveBeenCalledWith("empresa-1", expect.objectContaining({ tamanoPagina: 50 }));
  });

  it("sin permiso de 'consultar': 403", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "consultar"));
    const res = await GET(peticion());
    expect(res.status).toBe(403);
  });
});
