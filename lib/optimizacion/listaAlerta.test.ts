import { beforeEach, describe, expect, it, vi } from "vitest";

// Lista filtrada por alerta: moderadas se pagina sobre under_review y luego pending.
const ml = vi.hoisted(() => ({ listar: vi.fn(), leer: vi.fn(), precio: vi.fn(), comp: vi.fn(), cal: vi.fn() }));
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: async () => [] }));
vi.mock("@/db/schema", () => ({ publicaciones: {} }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerAccessTokenVigente: async () => "t" }));
vi.mock("@/lib/ml/cliente", () => ({
  buscarItemsPorSkuMl: vi.fn(),
  leerItemsOptimizacionMl: ml.leer,
  listarItemsVendedorMl: ml.listar,
  PATRON_ID_PRODUCTO_O_ITEM: /^[A-Z]{3}\d+$/,
}));
vi.mock("@/lib/optimizacion/ventas", () => ({ ventasRecientesPorItem: async () => new Map() }));
vi.mock("@/lib/optimizacion/alertasDatos", () => ({ alertaPrecioAlto: ml.precio, alertaCompetencia: ml.comp, alertaCalidad: ml.cal }));

import { leerPaginaOptimizacion } from "./lista";
import { leerPeriodoLista } from "./periodoLista";

const cuenta = { id: "c", cuentaIdExterna: "1", siteId: "MCO" };
const filtros = { estado: "pausadas" as const, texto: "ignorado", pagina: 1, periodo: leerPeriodoLista({}, new Date()) };
const ids = (n: number, d = 0) => Array.from({ length: n }, (_, i) => `MCO${d + i + 1}`);

beforeEach(() => {
  for (const f of Object.values(ml)) f.mockReset();
  ml.leer.mockImplementation(async (l: string[]) => l.map((id) => ({ id, titulo: id })));
});

describe("leerPaginaOptimizacion con ?alerta=", () => {
  it("moderadas: completa la página con pending e ignora estado y búsqueda", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(2), total: 2 }).mockResolvedValueOnce({ ids: ids(3, 100), total: 3 });
    const r = await leerPaginaOptimizacion("e", cuenta, { ...filtros, alerta: "moderadas" }, new Date());
    expect(ml.listar.mock.calls[0][2]).toMatchObject({ estado: "under_review", offset: 0 });
    expect(ml.listar.mock.calls[1][2]).toMatchObject({ estado: "pending", offset: 0, limite: 48 });
    expect(r.total).toBe(5);
    expect(r.filas).toHaveLength(5);
    expect(r.alerta?.clave).toBe("moderadas");
  });
  it("precio alto: lee los ids de la alerta y entrega las referencias", async () => {
    ml.precio.mockResolvedValue({ cantidad: 1, ids: ["MCO7"], referencias: { MCO7: { estado: "with_benchmark_high" } } });
    const r = await leerPaginaOptimizacion("e", cuenta, { ...filtros, alerta: "precio_alto" }, new Date());
    expect(r.filas.map((f) => f.id)).toEqual(["MCO7"]);
    expect(r.alerta?.referencias).toHaveProperty("MCO7");
    expect(ml.listar).not.toHaveBeenCalled();
  });
  it("sin stock: pagina las pausadas por out_of_stock", async () => {
    ml.listar.mockResolvedValueOnce({ ids: ids(2), total: 8 });
    const r = await leerPaginaOptimizacion("e", cuenta, { ...filtros, alerta: "sin_stock" }, new Date());
    expect(ml.listar.mock.calls[0][2]).toMatchObject({ estado: "paused", subEstado: "out_of_stock", offset: 0 });
    expect(r.total).toBe(8);
    expect(r.alerta?.clave).toBe("sin_stock");
  });
  it("calidad: entrega los objetivos pendientes de cada publicación", async () => {
    ml.cal.mockResolvedValue({ cantidad: 1, ids: ["MCO9"], pendientes: { MCO9: ["Agrega una foto"] } });
    const r = await leerPaginaOptimizacion("e", cuenta, { ...filtros, alerta: "calidad" }, new Date());
    expect(r.filas.map((f) => f.id)).toEqual(["MCO9"]);
    expect(r.alerta?.pendientes).toEqual({ MCO9: ["Agrega una foto"] });
  });
  it("competencia: estados de la alerta", async () => {
    ml.comp.mockResolvedValue({ cantidad: 1, ids: ["MCO8"], estados: { MCO8: "listed" } });
    const r = await leerPaginaOptimizacion("e", cuenta, { ...filtros, alerta: "competencia" }, new Date());
    expect(r.alerta?.estados).toEqual({ MCO8: "listed" });
  });
});
