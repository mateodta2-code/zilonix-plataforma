import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const resolverSesion = vi.fn();
const requierePermiso = vi.fn();
vi.mock("../../ml/promociones/_ayudantes", () => ({
  resolverSesionYEmpresa: () => resolverSesion(),
  respuestaSiSinPermiso: (e: unknown) => (e instanceof Error && e.message === "sin-permiso" ? NextResponse.json({ error: "No tenés permiso para esto." }, { status: 403 }) : null),
}));
vi.mock("@/lib/permisos", () => ({ requierePermiso: (...a: unknown[]) => requierePermiso(...a) }));

import { POST } from "./route";

const req = (cuerpo: unknown) => new Request("http://x/api/extension/nicho", { method: "POST", body: JSON.stringify(cuerpo) });
const p = (itemId: string, vendidos: number | null, precio: number, extra: object = {}) => ({ titulo: "P " + itemId, precio, vendidos, itemId, link: "https://x.test/" + itemId, ...extra });

describe("POST /api/extension/nicho", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolverSesion.mockResolvedValue({ usuario: { id: "u" }, empresa: { id: "e", nombre: "E" } });
    requierePermiso.mockResolvedValue(undefined);
  });

  it("sin sesión devuelve 401 y no calcula nada", async () => {
    resolverSesion.mockResolvedValue(NextResponse.json({ error: "Sin sesión." }, { status: 401 }));
    expect((await POST(req({ host: "www.mercadolibre.com.co", productos: [] }))).status).toBe(401);
    expect(requierePermiso).not.toHaveBeenCalled();
  });

  it("sin permiso devuelve 403", async () => {
    requierePermiso.mockRejectedValue(new Error("sin-permiso"));
    expect((await POST(req({ host: "www.mercadolibre.com.co", productos: [] }))).status).toBe(403);
  });

  it("rechaza cuerpo inválido y países no soportados", async () => {
    expect((await POST(req({ host: "www.mercadolibre.com.co" }))).status).toBe(400);
    const r = await POST(req({ host: "www.mercadolibre.com.uy", productos: [p("MLU1", 5, 100)] }));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("pais_no_soportado");
  });

  it("devuelve la tabla con moneda del sitio, Full y '—' (null) sin datos", async () => {
    const r = await POST(
      req({
        host: "listado.mercadolibre.com.mx",
        productos: [p("MLM1500000100", 500, 200, { esFull: true }), p("MLM1500000101", null, 300), { titulo: "sin precio" }],
      })
    );
    const j = await r.json();
    expect(j.ok).toBe(true);
    expect(j.sitio.moneda).toBe("MXN");
    expect(j.filas).toHaveLength(2);
    const sinVendidos = j.filas.find((f: { titulo: string }) => f.titulo === "P MLM1500000101");
    expect(sinVendidos.ventasMes).toBeNull();
    expect(sinVendidos.factMes).toBeNull();
    expect(sinVendidos.origen).toBeNull();
    expect(j.filas.find((f: { titulo: string }) => f.titulo === "P MLM1500000100").esFull).toBe(true);
    expect(j.filas[0].precio).toMatch(/MX\$|\$/);
    expect(j.filas[0].precio).not.toMatch(/COP/);
  });

  it("ordena por la columna pedida, con 'sin dato' siempre al final", async () => {
    const productos = [p("MCO1500000001", 100, 5_000), p("MCO1500000002", 100, 9_000), p("MCO1500000003", null, 1_000)];
    const base = { host: "www.mercadolibre.com.co", productos };
    const porDefecto = await (await POST(req(base))).json();
    expect(porDefecto.orden).toEqual({ columna: "factMes", direccion: "desc" });
    expect(porDefecto.filas.map((f: { titulo: string }) => f.titulo)).toEqual(["P MCO1500000002", "P MCO1500000001", "P MCO1500000003"]);
    const asc = await (await POST(req({ ...base, columna: "factMes", direccion: "asc" }))).json();
    expect(asc.filas.map((f: { titulo: string }) => f.titulo)).toEqual(["P MCO1500000001", "P MCO1500000002", "P MCO1500000003"]);
    const porPrecio = await (await POST(req({ ...base, columna: "precio", direccion: "asc" }))).json();
    expect(porPrecio.filas[0].titulo).toBe("P MCO1500000003");
    expect(porPrecio.filas.map((f: { n: number }) => f.n)).toEqual([1, 2, 3]);
  });

  it("columna inválida cae al orden por defecto; tope de 150 publicaciones", async () => {
    const muchos = Array.from({ length: 200 }, (_, i) => p("MCO15000" + (10000 + i), 10, 100));
    const j = await (await POST(req({ host: "www.mercadolibre.com.co", productos: muchos, columna: "x'; drop" }))).json();
    expect(j.orden.columna).toBe("factMes");
    expect(j.filas).toHaveLength(150);
  });

  it("devuelve origen Internacional/Local/null, Full aparte, puntaje, concentración y precio recomendado", async () => {
    const productos = [
      p("MCO1500000001", 700, 50_000, { internacional: true, vendedor: "a" }),
      p("MCO1500000002", 100, 52_000, { internacional: false, esFull: true, vendedor: "b" }),
      p("MCO1500000003", 100, 51_000, { vendedor: "c" }),
      p("MCO1500000004", 50, 90_000, { vendedor: "d", tiendaOficial: true }),
      p("MCO1500000005", 50, 95_000, { vendedor: "e" }),
      p("MCO1500000006", 50, 99_000, { vendedor: "f" }),
    ];
    const j = await (await POST(req({ host: "listado.mercadolibre.com.co", productos }))).json();
    const por = (id: string) => j.filas.find((f: { titulo: string }) => f.titulo === "P " + id);
    expect(por("MCO1500000001").origen).toBe("Internacional");
    expect(por("MCO1500000002").origen).toBe("Local");
    expect(por("MCO1500000002").esFull).toBe(true);
    expect(por("MCO1500000003").origen).toBeNull();
    expect(j.analisis.puntaje.valor).toBeGreaterThanOrEqual(1);
    expect(j.analisis.puntaje.valor).toBeLessThanOrEqual(10);
    expect(j.analisis.puntaje.explicacion).toBeTruthy();
    expect(j.analisis.concentracion.porcentaje).toBeGreaterThan(60);
    expect(j.analisis.concentracion.aviso).toBe("Nicho concentrado en pocos vendedores");
    expect(j.analisis.precioRecomendado.texto).toMatch(/^Precio donde más se vende: .+ a .+/);
    expect(j.analisis.nota).toBe("Ventas/mes, antigüedad y facturación son estimados");
  });
});
