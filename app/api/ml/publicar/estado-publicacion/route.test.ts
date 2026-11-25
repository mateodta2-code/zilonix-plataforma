import { beforeEach, describe, expect, it, vi } from "vitest";

const ID = "22222222-2222-2222-2222-222222222222";

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

const { filasPorTabla, empresasUsadas } = vi.hoisted(() => ({ filasPorTabla: new Map<unknown, unknown[]>(), empresasUsadas: [] as string[] }));

// "tx" mínima: devuelve lo programado por tabla (la RLS real se prueba en
// las pruebas con Postgres; acá se verifica que se use dbComoEmpresa con la
// empresa de la sesión).
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (empresaId: string, fn: (tx: unknown) => unknown) => {
    empresasUsadas.push(empresaId);
    const tx = {
      select: () => ({ from: (tabla: unknown) => ({ where: () => Promise.resolve(filasPorTabla.get(tabla) ?? []) }) }),
    };
    return fn(tx);
  },
}));

import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { cuentasMl, productosMl } from "@/db/schema";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { GET } from "./route";

const peticion = (id: string = ID) => new NextRequest(`https://staging.test/api/ml/publicar/estado-publicacion?id=${id}`);

describe("GET /api/ml/publicar/estado-publicacion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    empresasUsadas.length = 0;
    filasPorTabla.clear();
    vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });

  it("sin sesión -> 401", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    expect((await GET(peticion())).status).toBe(401);
  });

  it("sin permiso -> 403 y no toca la base", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("inventario", "consultar"));
    expect((await GET(peticion())).status).toBe(403);
    expect(empresasUsadas).toHaveLength(0);
  });

  it("id inválido -> 400", async () => {
    expect((await GET(peticion("no-es-uuid"))).status).toBe(400);
  });

  it("publicación de otra empresa (RLS no la devuelve) -> 404", async () => {
    const res = await GET(peticion());
    expect(res.status).toBe(404);
  });

  it("devuelve solo { estado, hechos, total }, con la empresa de la sesión", async () => {
    filasPorTabla.set(productosMl, [{ estado: "publicando", hechos: 1, seleccionadas: ["a", "b"], resultado: [{ secreto: "no sale" }] }]);
    filasPorTabla.set(cuentasMl, [{ total: 2 }]);
    const res = await GET(peticion());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ estado: "publicando", hechos: 1, total: 2 });
    expect(empresasUsadas.every((e) => e === "empresa-1")).toBe(true);
    expect(requierePermiso).toHaveBeenCalledWith("usuario-1", "empresa-1", "inventario", "consultar");
  });
});
