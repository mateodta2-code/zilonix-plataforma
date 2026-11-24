import { beforeEach, describe, expect, it, vi } from "vitest";

// Promo-B — el endpoint de bitácora. Se mockea solo la sesión y la base
// (el aislamiento real por RLS lo cubre db/rls-promociones.test.ts contra
// Postgres real); acá se prueba validación de filtros, paginación y que
// nunca salga el JSON crudo de Mercado Libre.
vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "empresa-1", nombre: "Empresa de prueba" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "usuario-1" })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/url-publica", () => ({ urlPublicaBase: () => "https://staging.test" }));

const { filasDb, empresasUsadas, offsets } = vi.hoisted(() => ({
  filasDb: { valor: [] as Record<string, unknown>[] },
  empresasUsadas: [] as string[],
  offsets: [] as number[],
}));

vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (empresaId: string, fn: (tx: unknown) => unknown) => {
    empresasUsadas.push(empresaId);
    const cadena: Record<string, unknown> = {};
    for (const m of ["select", "from", "innerJoin", "leftJoin", "where", "orderBy", "limit", "groupBy"]) cadena[m] = () => cadena;
    cadena.offset = async (n: number) => {
      offsets.push(n);
      return filasDb.valor;
    };
    return fn(cadena);
  },
}));

import { cookies } from "next/headers";
import { GET } from "./route";

const CUENTA = "11111111-1111-4111-8111-111111111111";

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: "a1",
    cuentaMlId: CUENTA,
    nicknameCuenta: "TIENDA",
    itemId: "MCO1",
    tituloProducto: "Producto",
    tipoPromocion: "DEAL",
    promotionIdMl: "p1",
    accion: "participar",
    precioAntes: "100000",
    precioDespues: "90000",
    estado: "ejecutada",
    ejecutadoPorNombre: "Ana",
    modoSimulacion: false,
    resultadoMl: { ok: true, status: 200, regla: "maximo", origen: "lote", token: "SECRETO", respuesta: "x".repeat(900) },
    error: null,
    creadoTs: new Date().toISOString(),
    ...extra,
  };
}

const pedir = (qs = "") => GET(new Request(`https://x.test/api/ml/promociones/historial${qs}`));

describe("GET /api/ml/promociones/historial", () => {
  beforeEach(() => {
    vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
    filasDb.valor = [fila()];
    empresasUsadas.length = 0;
    offsets.length = 0;
  });

  it("consulta siempre con dbComoEmpresa de la empresa de la sesión", async () => {
    await pedir();
    expect(empresasUsadas).toEqual(["empresa-1"]);
  });

  it("nunca devuelve el JSON crudo y recorta la respuesta de ML a 500 caracteres", async () => {
    const cuerpo = await (await pedir()).json();
    const f = cuerpo.filas[0];
    expect(f.resultadoMl).toBeUndefined();
    expect(JSON.stringify(cuerpo)).not.toContain("SECRETO");
    expect(f.detalle.respuesta).toHaveLength(500);
    expect(f.detalle).toMatchObject({ regla: "maximo", origen: "lote", ok: true, status: 200 });
  });

  it("pagina de a 50 y avisa si hay más", async () => {
    filasDb.valor = Array.from({ length: 51 }, (_, i) => fila({ id: `a${i}` }));
    const cuerpo = await (await pedir("?pagina=3")).json();
    expect(cuerpo.filas).toHaveLength(50);
    expect(cuerpo.hayMas).toBe(true);
    expect(offsets).toEqual([100]);
  });

  it("rechaza cuentaId y fechas inválidas con 400", async () => {
    expect((await pedir("?cuentaId=nada")).status).toBe(400);
    expect((await pedir("?desde=ayer")).status).toBe(400);
    expect((await pedir("?hasta=2026-13-45")).status).toBe(400);
  });

  it("acepta filtros válidos", async () => {
    const res = await pedir(`?cuentaId=${CUENTA}&accion=salir&resultado=error&desde=2026-01-01&hasta=2026-01-31`);
    expect(res.status).toBe(200);
  });

  it("vista=tandas devuelve encabezados agrupados y pagina por tanda", async () => {
    filasDb.valor = Array.from({ length: 51 }, (_, i) => ({ clave: `t${i}`, total: 100, participo: 80, salio: 0, modifico: 0, conError: 0, omitidas: 20, noApi: 0, simulada: false, regla: "todas", usuarioNombre: "Ana", cuentaMlId: CUENTA, nicknameCuenta: "T", fecha: "2026-01-01" }));
    const cuerpo = await (await pedir("?vista=tandas&pagina=2")).json();
    expect(cuerpo.tandas).toHaveLength(50);
    expect(cuerpo.hayMas).toBe(true);
    expect(cuerpo.tandas[0]).toMatchObject({ total: 100, participo: 80, omitidas: 20 });
    expect(offsets).toEqual([50]);
    expect(empresasUsadas).toEqual(["empresa-1"]);
  });

  it("devuelve las filas de una tanda por lote y valida el formato", async () => {
    expect((await pedir("?lote=nada")).status).toBe(400);
    filasDb.valor = [fila({ resultadoMl: { regla: "salir", origen: "salir-todas", lote: "L", limite: "ml", motivo: "m".repeat(900), nombrePromocion: "Camp", sku: "S", token: "SECRETO" } })];
    const cuerpo = await (await pedir(`?lote=${CUENTA}`)).json();
    expect(cuerpo.filas[0].detalle).toMatchObject({ limite: "ml", nombrePromocion: "Camp", sku: "S", lote: "L" });
    expect(cuerpo.filas[0].detalle.motivo).toHaveLength(500);
    expect(JSON.stringify(cuerpo)).not.toContain("SECRETO");
  });

  it("sin permiso de consultar no consulta nada", async () => {
    const { requierePermiso, SinPermisoError } = await import("@/lib/permisos");
    vi.mocked(requierePermiso).mockRejectedValueOnce(new (SinPermisoError as unknown as new (m: string) => Error)("no"));
    const res = await pedir("?vista=tandas");
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(empresasUsadas).toEqual([]);
  });
});
