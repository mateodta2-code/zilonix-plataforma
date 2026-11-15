import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mismo patrón que app/api/ml/promociones/buscar/route.test.ts.
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
  return { requierePermiso: vi.fn(async () => ({ permisos: [] })), SinPermisoError };
});

// Rama fix-promociones-aprobar-no-ejecuta, punto 1 — la ruta ahora
// hace DOS consultas en paralelo: el count(*) de siempre (.from().where())
// y la lista de filas para el modal (.from().innerJoin().where().orderBy().limit()).
// El mock diferencia las dos por la forma de la cadena, no por el
// contenido real del .where() (mismo atajo de siempre en este repo).
const { totalProgramado, filasProgramadas } = vi.hoisted(() => ({
  totalProgramado: { valor: 0 },
  filasProgramadas: { valor: [] as unknown[] },
}));
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_empresaId: string, fn: (tx: unknown) => unknown) => {
    type EncadenableJoin = { where: () => EncadenableJoin; orderBy: () => EncadenableJoin; limit: () => Promise<unknown[]> };
    const tx = {
      select: () => ({
        from: () => {
          const encadenableJoin: EncadenableJoin = {
            where: () => encadenableJoin,
            orderBy: () => encadenableJoin,
            limit: () => Promise.resolve(filasProgramadas.valor),
          };
          return {
            where: () => Promise.resolve([{ total: totalProgramado.valor }]),
            innerJoin: () => encadenableJoin,
          };
        },
      }),
    };
    return fn(tx);
  },
}));

import { cookies } from "next/headers";
import { requierePermiso } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { GET } from "./route";

function mockearCookies() {
  vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
}

// Review de Pablo (PR #304), punto 2 — "Lanzar aprobadas a Mercado
// Libre (N)" necesita el total REAL (count(*), nunca el .limit(200)
// de /historial, que corta antes de reflejar lotes grandes).
describe("GET /api/ml/promociones/acciones/pendientes-lanzar — rama feat-promociones-aprobacion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockearCookies();
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValue({ id: "usuario-1" } as never);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
    totalProgramado.valor = 0;
    filasProgramadas.valor = [];
  });

  afterEach(() => vi.unstubAllGlobals());

  it("sin sesión -> 401", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('sin permiso "consultar" -> 403', async () => {
    const { SinPermisoError } = (await import("@/lib/permisos")) as unknown as { SinPermisoError: new (m: string, a: string) => Error };
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "consultar"));
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("devuelve el total real, no limitado a 200 — un lote más grande sale completo", async () => {
    totalProgramado.valor = 347;
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(347);
  });

  it("sin ninguna acción aceptada pendiente: 0, nunca null/undefined", async () => {
    totalProgramado.valor = 0;
    const res = await GET();
    const body = await res.json();
    expect(body.total).toBe(0);
  });

  // Rama fix-promociones-aprobar-no-ejecuta, punto 1 — el modal de
  // "Lanzar aprobadas" tiene que poder listar producto/precio/cuenta
  // antes de dejar confirmar, nunca solo el número.
  it("devuelve también las filas (producto, precio, cuenta) para el modal de confirmación", async () => {
    totalProgramado.valor = 2;
    filasProgramadas.valor = [
      { id: "a1", cuentaMlId: "cuenta-1", nicknameCuenta: "Cuenta Uno", itemId: "MCO1", tituloProducto: "VITALCARNITINA", tipoPromocion: "DEAL", precioAntes: "80000", precioDespues: "69900" },
      { id: "a2", cuentaMlId: "cuenta-1", nicknameCuenta: "Cuenta Uno", itemId: "MCO2", tituloProducto: "VITALREMOLACHA", tipoPromocion: "DEAL", precioAntes: "75000", precioDespues: "60000" },
    ];
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.filas).toHaveLength(2);
    expect(body.filas[0]).toMatchObject({ tituloProducto: "VITALCARNITINA", nicknameCuenta: "Cuenta Uno", precioDespues: "69900" });
  });
});
