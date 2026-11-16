import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PedidoListado } from "@/lib/pedidos/listado";

// Issue #422 — /panel/pedidos informativo. Se simulan la sesión, los
// permisos, las cuentas y la lectura unificada (que tiene su propia
// prueba contra Postgres real en lib/pedidos/listado.test.ts). Acá se
// prueba lo que ve la persona: tarjetas de los dos marketplaces, sin un
// solo dato de costo, y que entra con solo ventas.consultar.
const { requierePermisoMock, listarMock, cuentasMlMock, cuentasFalaMock } = vi.hoisted(() => ({
  requierePermisoMock: vi.fn(),
  listarMock: vi.fn(),
  cuentasMlMock: vi.fn(),
  cuentasFalaMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1", nombre: "Empresa" }] }));
vi.mock("@/lib/membresias", () => ({ obtenerMiMembresia: async () => ({ rolNombre: "Operador" }) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { requierePermiso: requierePermisoMock, SinPermisoError };
});
vi.mock("@/lib/ml/cuentas", () => ({ listarCuentasConectadas: cuentasMlMock }));
vi.mock("@/lib/falabella/cuentas", () => ({ listarCuentasConectadas: cuentasFalaMock }));
vi.mock("@/lib/pedidos/listado", () => ({ listarPedidosUnificados: listarMock }));
vi.mock("@/components/finanzas/DetalleDiaCuentaProducto", () => ({
  DetalleDiaCuentaProducto: () => {
    throw new Error("Pedidos no debe usar el detalle de Finanzas");
  },
}));

import { SinPermisoError } from "@/lib/permisos";
import PedidosPage from "./page";

const pedidoMl: PedidoListado = {
  clave: "ml:p-1",
  id: "p-1",
  marketplace: "ml",
  pedidoIdExterno: "2000001",
  fecha: new Date("2026-11-10T20:00:00Z"),
  total: "129000.00",
  moneda: "COP",
  cuenta: "TIENDA_ML",
  estado: { valor: "listo", etiqueta: "Listo para enviar", color: "advertencia" },
  productos: [{ nombre: "Gorra azul", sku: "GOR-1", cantidad: 2, imagenUrl: "https://http2.mlstatic.com/D_foto-I.jpg" }],
};
const pedidoFala: PedidoListado = {
  clave: "falabella:f-1",
  id: "f-1",
  marketplace: "falabella",
  pedidoIdExterno: "777001",
  fecha: new Date("2026-11-10T15:00:00Z"),
  total: "78000.00",
  moneda: "COP",
  cuenta: "zilonix falabella",
  estado: { valor: null, etiqueta: "returned", color: "neutro" },
  productos: [{ nombre: "Lámpara LED", sku: "LAMP-1", cantidad: 1, imagenUrl: null }],
};

async function pintar(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await PedidosPage({ searchParams }));
}

describe("PedidosPage — lista informativa (#422)", () => {
  beforeEach(() => {
    // Solo ventas.consultar: cualquier otro permiso que se pida falla.
    requierePermisoMock.mockImplementation(async (_u: string, _e: string, modulo: string, accion: string) => {
      if (modulo !== "ventas" || accion !== "consultar") throw new SinPermisoError("ventas", "consultar");
    });
    cuentasMlMock.mockResolvedValue([{ id: "11111111-1111-1111-1111-111111111111", nickname: "TIENDA_ML" }]);
    cuentasFalaMock.mockResolvedValue([{ id: "22222222-2222-2222-2222-222222222222", nickname: "zilonix falabella" }]);
    listarMock.mockResolvedValue({ pedidos: [pedidoMl, pedidoFala], hayMas: false });
  });
  afterEach(() => vi.clearAllMocks());

  it("con solo ventas.consultar entra y ve tarjetas de ML y Falabella con sello, estado y valor", async () => {
    const html = await pintar();
    expect(requierePermisoMock).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "finanzas", expect.anything());
    expect(html).toContain('data-marketplace="ml"');
    expect(html).toContain('data-marketplace="falabella"');
    expect(html).toContain("Gorra azul");
    expect(html).toContain("SKU: GOR-1");
    expect(html).toContain("Cantidad: 2");
    expect(html).toContain("Pedido #2000001");
    expect(html).toContain("Tienda TIENDA_ML");
    expect(html).toContain("Listo para enviar");
    expect(html).toContain("returned");
    expect(html).toMatch(/129\.000/);
    expect(html).toContain('href="/panel/pedidos/p-1"');
    expect(html).not.toContain('href="/panel/pedidos/f-1"');
  });

  it("la respuesta no contiene costo, utilidad, comisión, flete ni packing", async () => {
    const html = (await pintar()).toLowerCase();
    for (const palabra of ["costo", "utilidad", "comisión", "comision", "flete", "packing", "empaque", "margen"]) {
      expect(html).not.toContain(palabra);
    }
  });

  it("los filtros llegan validados a la consulta", async () => {
    await pintar({ marketplace: "falabella", estado: "inventado", tienda: "ml:de-otra-empresa", q: "  lámpara " });
    const [empresaId, filtros] = listarMock.mock.calls[0];
    expect(empresaId).toBe("empresa-1");
    expect(filtros).toMatchObject({ marketplace: "falabella", estado: null, tienda: null, q: "lámpara", periodo: "mes" });
  });

  it("un comercio solo con Falabella entra y ve su lista, sin pedir conectar Mercado Libre", async () => {
    cuentasMlMock.mockResolvedValue([]);
    listarMock.mockResolvedValue({ pedidos: [pedidoFala], hayMas: false });
    const html = await pintar();
    expect(html).toContain("Lámpara LED");
    expect(html).not.toContain("conecta");
  });

  it("sin ninguna cuenta: indica conectar, sin botón si el rol no llega a configuración", async () => {
    cuentasMlMock.mockResolvedValue([]);
    cuentasFalaMock.mockResolvedValue([]);
    listarMock.mockResolvedValue({ pedidos: [], hayMas: false });
    const html = await pintar();
    expect(html).toContain("conectar una cuenta de Mercado Libre o de Falabella");
    expect(html).not.toContain('href="/panel/conectar-ml"');
  });

  it("sin ventas.consultar muestra Sin acceso y no lee nada", async () => {
    requierePermisoMock.mockRejectedValue(new SinPermisoError("ventas", "consultar"));
    const html = await pintar();
    expect(html).toContain("no puede ver Pedidos");
    expect(listarMock).not.toHaveBeenCalled();
  });

  it("paginación: Siguiente conserva los filtros válidos", async () => {
    listarMock.mockResolvedValue({ pedidos: [pedidoMl], hayMas: true });
    const html = await pintar({ marketplace: "ml", pagina: "2" });
    expect(html).toContain('href="/panel/pedidos?marketplace=ml&amp;pagina=3"');
    expect(html).toContain('href="/panel/pedidos?marketplace=ml"');
  });

  it("solo una cuenta desconectada: ve el aviso de conectar y la tienda marcada (revisión PR #433)", async () => {
    cuentasMlMock.mockResolvedValue([]);
    cuentasFalaMock.mockResolvedValue([{ id: "22222222-2222-2222-2222-222222222222", nickname: "vieja", desconectadaTs: new Date("2026-10-01T00:00:00Z") }]);
    listarMock.mockResolvedValue({ pedidos: [], hayMas: false });
    const html = await pintar();
    expect(html).toContain("conectar una cuenta de Mercado Libre o de Falabella");
    expect(html).toContain("vieja · Falabella (desconectada)");
  });
});
