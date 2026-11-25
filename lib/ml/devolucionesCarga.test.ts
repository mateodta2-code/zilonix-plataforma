import { describe, expect, it, vi } from "vitest";

const pedir = vi.fn();
vi.mock("@/lib/ml/cuentas", () => ({
  listarCuentasConectadas: vi.fn(async () => [{ id: "c1", nickname: "tienda", siteId: "MCO", cuentaIdExterna: "111", desconectadaTs: null }]),
  obtenerAccessTokenVigente: vi.fn(async () => "tok"),
}));
vi.mock("@/lib/ml/preguntas", () => ({ motivoCuentaSinRevisar: () => "motivo" }));
vi.mock("@/lib/ml/cliente", async (orig) => ({ ...(await orig<object>()), pedirLecturaMl: (...a: unknown[]) => pedir(...a) }));

const { cargarDevolucionesEmpresa } = await import("@/lib/ml/devoluciones");

describe("cargarDevolucionesEmpresa", () => {
  it("solo muestra los candidatos con devolución (v2 returns no 404)", async () => {
    const f = new Date().toISOString();
    pedir.mockImplementation(async (ruta: string) => {
      if (ruta.includes("claims/search")) return { ok: true, status: 200, data: { paging: { total: 2 }, data: [{ id: 1, date_created: f }, { id: 2, date_created: f }] } };
      if (ruta.includes("/claims/1/returns")) return { ok: true, status: 200, data: { id: 9, status: "opened" } };
      return { ok: false, status: 404, data: null };
    });
    const r = await cargarDevolucionesEmpresa("e", { cuentaId: null, desdeMs: Date.now() - 86400000 });
    expect(r.filas.map((x) => x.reclamo.id)).toEqual(["1"]);
    expect(r.cuentasSinRevisar).toEqual([]);
  });
  it("si la búsqueda falla, la cuenta queda sin revisar", async () => {
    pedir.mockResolvedValue({ ok: false, status: 500, data: null });
    const r = await cargarDevolucionesEmpresa("e", { cuentaId: null, desdeMs: Date.now() - 86400000 });
    expect(r.filas).toEqual([]);
    expect(r.cuentasSinRevisar).toEqual([{ nickname: "tienda", motivo: "motivo" }]);
  });
});
