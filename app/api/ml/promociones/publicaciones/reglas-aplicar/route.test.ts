import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

const { aplicarReglaALoteMock } = vi.hoisted(() => ({
  aplicarReglaALoteMock: vi.fn(async () => ({ revisadas: 0, participadas: 0, fallidas: 0, omitidas: 0, filas: [] })),
}));
vi.mock("@/lib/ml/promocionesPublicaciones", () => ({ aplicarReglaALote: aplicarReglaALoteMock }));

const { vistaPreviaSalirTodasMock, salirDeTodasLasPromocionesMock } = vi.hoisted(() => ({
  vistaPreviaSalirTodasMock: vi.fn(async () => ({ revisadas: 3, publicaciones: 2, promociones: 3, salibles: 2, noPermitidas: 1, lecturasConError: 0, porTipo: {} })),
  salirDeTodasLasPromocionesMock: vi.fn(async () => ({ revisadas: 3, salieron: 2, errores: 0, noPermitidas: 1, filas: [] })),
}));
vi.mock("@/lib/ml/promocionesSalirTodas", () => ({ vistaPreviaSalirTodas: vistaPreviaSalirTodasMock, salirDeTodasLasPromociones: salirDeTodasLasPromocionesMock }));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { TOPE_ITEMS_SELECCION } from "@/lib/ml/promocionesSeleccion";
import { POST } from "./route";

const CUENTA_ID = "11111111-1111-1111-1111-111111111111";
const SELECCION = [
  { cuentaId: CUENTA_ID, itemId: "MCO111111" },
  { cuentaId: CUENTA_ID, itemId: "MCO222222" },
];

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(cuerpo: Record<string, unknown>, origin = "https://staging.test"): Request {
  return new Request("https://staging.test/api/ml/promociones/publicaciones/reglas-aplicar", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(cuerpo),
  });
}

describe("POST /api/ml/promociones/publicaciones/reglas-aplicar — Tarea Promociones real (Refs #295)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("regla 'todas': delega al módulo real", async () => {
    const res = await POST(peticion({ seleccion: SELECCION, regla: "todas" }));
    expect(res.status).toBe(200);
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", SELECCION, { tipo: "todas" });
  });

  it("regla 'maximo' con maximoPct válido: lo pasa tal cual", async () => {
    await POST(peticion({ seleccion: SELECCION, regla: "maximo", maximoPct: 15 }));
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", SELECCION, { tipo: "maximo", maximoPct: 15 });
  });

  it("regla 'maximo' sin maximoPct (o fuera de rango): 400, nunca llega al módulo", async () => {
    const res1 = await POST(peticion({ seleccion: SELECCION, regla: "maximo" }));
    expect(res1.status).toBe(400);
    const res2 = await POST(peticion({ seleccion: SELECCION, regla: "maximo", maximoPct: 150 }));
    expect(res2.status).toBe(400);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("regla 'tabla-maestra': delega igual, sin maximoPct", async () => {
    await POST(peticion({ seleccion: SELECCION, regla: "tabla-maestra" }));
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", SELECCION, { tipo: "tabla-maestra" });
  });

  it("regla inválida: 400", async () => {
    const res = await POST(peticion({ seleccion: SELECCION, regla: "lo-que-sea" }));
    expect(res.status).toBe(400);
  });

  it("Promo-A: lista vacía, ausente o 'todas' (el formato viejo): 400, nunca llega al módulo", async () => {
    for (const cuerpo of [{ regla: "todas", seleccion: [] }, { regla: "todas" }, { regla: "todas", cuentaId: "todas" }, { regla: "todas", seleccion: "todas" }]) {
      const res = await POST(peticion(cuerpo));
      expect(res.status).toBe(400);
    }
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("Promo-A: elemento inválido (cuenta no UUID o itemId raro): 400", async () => {
    const res1 = await POST(peticion({ regla: "todas", seleccion: [{ cuentaId: "no-es-un-uuid", itemId: "MCO111111" }] }));
    const res2 = await POST(peticion({ regla: "todas", seleccion: [{ cuentaId: CUENTA_ID, itemId: "x'; DROP" }] }));
    expect(res1.status).toBe(400);
    expect(res2.status).toBe(400);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("Promo-A: más del tope de publicaciones: 400", async () => {
    const demasiadas = Array.from({ length: TOPE_ITEMS_SELECCION + 1 }, (_, i) => ({ cuentaId: CUENTA_ID, itemId: `MCO${100000 + i}` }));
    const res = await POST(peticion({ regla: "todas", seleccion: demasiadas }));
    expect(res.status).toBe(400);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("Promo-A: duplicados se descartan — nunca se escribe dos veces la misma publicación", async () => {
    await POST(peticion({ regla: "todas", seleccion: [SELECCION[0], SELECCION[0], SELECCION[1]] }));
    expect(aplicarReglaALoteMock).toHaveBeenCalledWith("empresa-1", "usuario-1", SELECCION, { tipo: "todas" });
  });

  it("origen inválido: 403, nunca llega a tocar nada", async () => {
    const res = await POST(peticion({ seleccion: SELECCION, regla: "todas" }, "https://otro-sitio.test"));
    expect(res.status).toBe(403);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  it("sin permiso de 'ejecutar': 403", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "ejecutar"));
    const res = await POST(peticion({ seleccion: SELECCION, regla: "todas" }));
    expect(res.status).toBe(403);
    expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
  });

  describe("regla 'salir-todas' (dejar de participar en todas)", () => {
    it("vistaPrevia:true: solo cuenta (delega a la vista previa), NUNCA ejecuta ni escribe", async () => {
      const res = await POST(peticion({ seleccion: SELECCION, regla: "salir-todas", vistaPrevia: true }));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ publicaciones: 2, promociones: 3 });
      expect(vistaPreviaSalirTodasMock).toHaveBeenCalledWith("empresa-1", SELECCION);
      expect(salirDeTodasLasPromocionesMock).not.toHaveBeenCalled();
      expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
    });

    it("confirmado:true: ejecuta la salida masiva con el usuario real", async () => {
      const res = await POST(peticion({ seleccion: SELECCION, regla: "salir-todas", confirmado: true }));
      expect(res.status).toBe(200);
      expect(salirDeTodasLasPromocionesMock).toHaveBeenCalledWith("empresa-1", "usuario-1", SELECCION);
      expect(aplicarReglaALoteMock).not.toHaveBeenCalled();
    });

    it("sin confirmado (ni vistaPrevia): 400, nunca sale de nada sin el paso de confirmación", async () => {
      const res = await POST(peticion({ seleccion: SELECCION, regla: "salir-todas" }));
      expect(res.status).toBe(400);
      const res2 = await POST(peticion({ seleccion: SELECCION, regla: "salir-todas", confirmado: "si" }));
      expect(res2.status).toBe(400);
      expect(salirDeTodasLasPromocionesMock).not.toHaveBeenCalled();
    });

    it("exige el mismo permiso 'ejecutar' que 'Aplicar regla' — también para la vista previa", async () => {
      vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "ejecutar"));
      const res = await POST(peticion({ seleccion: SELECCION, regla: "salir-todas", vistaPrevia: true }));
      expect(res.status).toBe(403);
      expect(vi.mocked(requierePermiso)).toHaveBeenCalledWith("usuario-1", "empresa-1", "promociones", "ejecutar");
      expect(vistaPreviaSalirTodasMock).not.toHaveBeenCalled();
    });

    it("selección vacía: 400 antes de tocar nada", async () => {
      const res = await POST(peticion({ seleccion: [], regla: "salir-todas", confirmado: true }));
      expect(res.status).toBe(400);
      expect(salirDeTodasLasPromocionesMock).not.toHaveBeenCalled();
    });
  });
});
