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

const CUENTA_A = "11111111-1111-1111-1111-111111111111";
const CUENTA_B = "22222222-2222-2222-2222-222222222222";
vi.mock("@/lib/ml/cuentas", () => ({
  listarCuentasConectadas: vi.fn(async () => [
    { id: CUENTA_A, nickname: "A", desconectadaTs: null },
    { id: CUENTA_B, nickname: "B", desconectadaTs: null },
  ]),
}));

const { guardados, filasLeidas } = vi.hoisted(() => ({ guardados: [] as { valores: Record<string, unknown>; set: Record<string, unknown> }[], filasLeidas: [] as unknown[] }));
vi.mock("@/db/empresa-context", () => ({
  dbComoEmpresa: async (_e: string, fn: (tx: unknown) => unknown) =>
    fn({
      select: () => ({ from: () => ({ where: async () => filasLeidas }) }),
      insert: () => ({
        values: (valores: Record<string, unknown>) => ({
          onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
            guardados.push({ valores, set });
          },
        }),
      }),
    }),
}));

import { cookies } from "next/headers";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { GET, PUT } from "./route";

const JSON_VALIDO = { version: 1, exclusiones: [{ tipo: "compartida" }], maximoDescuentoPct: null, maximoPorSku: [], ventanasFecha: [], noEntendido: [] };

function put(cuerpo: unknown, origin = "https://staging.test"): Request {
  return new Request("https://staging.test/api/ml/promociones/reglas-adicionales", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
  });
}

describe("/api/ml/promociones/reglas-adicionales", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guardados.length = 0;
    filasLeidas.length = 0;
    vi.mocked(cookies).mockReturnValue({ get: () => undefined } as unknown as ReturnType<typeof cookies>);
    vi.mocked(requierePermiso).mockResolvedValue({} as never);
  });
  afterEach(() => vi.clearAllMocks());

  it("PUT sin permiso 'aprobar': 403, no guarda", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "aprobar"));
    expect((await PUT(put({ cuentaId: CUENTA_A, texto: "x", json: JSON_VALIDO, confirmado: true }))).status).toBe(403);
    expect(guardados).toHaveLength(0);
  });

  it("PUT sin `confirmado: true`: 400, no guarda nada", async () => {
    for (const confirmado of [undefined, false, "true", 1]) {
      expect((await PUT(put({ cuentaId: CUENTA_A, texto: "x", json: JSON_VALIDO, confirmado }))).status).toBe(400);
    }
    expect(guardados).toHaveLength(0);
  });

  it("PUT con JSON inválido (campo de más, % fuera de rango, ausente): 400", async () => {
    for (const json of [{ ...JSON_VALIDO, rol: "admin" }, { ...JSON_VALIDO, maximoDescuentoPct: 500 }, undefined, "texto"]) {
      expect((await PUT(put({ cuentaId: CUENTA_A, texto: "x", json, confirmado: true }))).status).toBe(400);
    }
    expect(guardados).toHaveLength(0);
  });

  it("PUT sin ninguna regla entendida (solo noEntendido): 400", async () => {
    const res = await PUT(put({ cuentaId: CUENTA_A, texto: "algo raro", json: { ...JSON_VALIDO, exclusiones: [], noEntendido: ["algo raro"] }, confirmado: true }));
    expect(res.status).toBe(400);
  });

  it("PUT con cuenta o texto inválidos / origen ajeno / JSON roto: 400 o 403", async () => {
    expect((await PUT(put({ cuentaId: "no-uuid", texto: "x", json: JSON_VALIDO, confirmado: true }))).status).toBe(400);
    expect((await PUT(put({ cuentaId: CUENTA_A, texto: "x".repeat(1001), json: JSON_VALIDO, confirmado: true }))).status).toBe(400);
    expect((await PUT(put("{roto"))).status).toBe(400);
    expect((await PUT(put({ cuentaId: CUENTA_A, texto: "x", json: JSON_VALIDO, confirmado: true }, "https://otro.test"))).status).toBe(403);
    expect((await PUT(put({ cuentaId: "33333333-3333-3333-3333-333333333333", texto: "x", json: JSON_VALIDO, confirmado: true }))).status).toBe(404);
    expect(guardados).toHaveLength(0);
  });

  it("PUT válido y confirmado: guarda texto + JSON validado SOLO en esa cuenta, sin tocar las demás reglas", async () => {
    const res = await PUT(put({ cuentaId: CUENTA_A, texto: "  no entrar en compartidas  ", json: JSON_VALIDO, confirmado: true }));
    expect(res.status).toBe(200);
    expect(guardados).toHaveLength(1);
    expect(guardados[0].valores).toMatchObject({ empresaId: "empresa-1", cuentaMlId: CUENTA_A, reglasAdicionalesTexto: "no entrar en compartidas", reglaParticipacion: "tabla-maestra" });
    expect(guardados[0].set).not.toHaveProperty("descuentoMaximoPct");
    expect(guardados[0].set).not.toHaveProperty("participarCompartidas");
  });

  it("PUT con cuentaId «todas»: la misma regla en cada cuenta conectada", async () => {
    const res = await PUT(put({ cuentaId: "todas", texto: "x", json: JSON_VALIDO, confirmado: true }));
    expect((await res.json()).cuentasActualizadas).toBe(2);
    expect(guardados.map((g) => g.valores.cuentaMlId).sort()).toEqual([CUENTA_A, CUENTA_B]);
  });

  it("PUT con texto vacío y confirmado: borra las reglas adicionales (no hace falta JSON)", async () => {
    const res = await PUT(put({ cuentaId: CUENTA_A, texto: "   ", confirmado: true }));
    expect(res.status).toBe(200);
    expect(guardados[0].set).toMatchObject({ reglasAdicionalesTexto: null, reglasAdicionalesJson: null });
  });

  it("GET sin permiso 'consultar': 403; con permiso, devuelve texto y JSON por cuenta", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("promociones", "consultar"));
    expect((await GET()).status).toBe(403);
    filasLeidas.push({ cuentaMlId: CUENTA_A, reglaParticipacion: "tabla-maestra", reglasAdicionalesTexto: "hola", reglasAdicionalesJson: JSON_VALIDO });
    const res = await GET();
    const cuerpo = await res.json();
    expect(cuerpo.filas.find((f: { cuentaId: string }) => f.cuentaId === CUENTA_A)).toMatchObject({ texto: "hola", json: JSON_VALIDO });
    expect(cuerpo.filas.find((f: { cuentaId: string }) => f.cuentaId === CUENTA_B)).toMatchObject({ texto: null, json: null });
  });
});
