import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mismo patrón que app/api/ml/promociones/candidatos/route.test.ts.
const CUENTA_1 = "11111111-1111-1111-1111-111111111111";

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
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: vi.fn(async () => "token-falso") }));
vi.mock("@/lib/ml/cliente", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/ml/cliente")>();
  return { ...real, obtenerFotoItemMl: vi.fn() };
});

const { filasPorTabla } = vi.hoisted(() => ({ filasPorTabla: new Map<unknown, unknown[]>() }));

// Mismo atajo que app/api/ml/promociones/candidatos/route.test.ts — una
// "tx" mínima que devuelve lo programado POR TABLA, ignorando la
// condición real del .where().
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    const tx = {
      select: () => ({
        from: (tabla: unknown) => {
          const filas = filasPorTabla.get(tabla) ?? [];
          const encadenable = { where: () => Promise.resolve(filas) };
          return encadenable;
        },
      }),
    };
    return fn(tx);
  },
}));

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { productosMl } from "@/db/schema";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { obtenerFotoItemMl } from "@/lib/ml/cliente";
import { GET } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

function peticion(opts: { cuentaId?: string; itemId?: string } = {}): NextRequest {
  const cuentaId = opts.cuentaId ?? CUENTA_1;
  const itemId = opts.itemId ?? "MCO1";
  return new NextRequest(`https://staging.test/api/ml/publicar/estado-item?cuentaId=${cuentaId}&itemId=${itemId}`);
}

describe("GET /api/ml/publicar/estado-item — revisión PR #371", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    filasPorTabla.clear();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });

  it("sin permiso -> 403, nunca llama a Mercado Libre", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "consultar"));
    const res = await GET(peticion());
    expect(res.status).toBe(403);
    expect(obtenerFotoItemMl).not.toHaveBeenCalled();
  });

  it("itemId que no es de esta empresa (o de otra cuenta) -> 404, nunca llama a Mercado Libre", async () => {
    filasPorTabla.set(productosMl, [
      { resultado: [{ cuentaMlId: "otra-cuenta", ok: true, itemId: "MCO1", status: "active" }] },
    ]);
    const res = await GET(peticion({ itemId: "MCO1", cuentaId: CUENTA_1 }));
    expect(res.status).toBe(404);
    expect(obtenerFotoItemMl).not.toHaveBeenCalled();
  });
});
