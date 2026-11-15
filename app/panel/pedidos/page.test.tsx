import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Issue #422 — /panel/pedidos con el filtro de marketplace. Se simulan la
// sesión, los permisos y las dos fuentes de datos: el detalle día a día
// de Mercado Libre (componente async compartido con Finanzas, con su
// propia prueba) y la lectura de Falabella. El aislamiento por empresa
// de esa lectura se prueba contra Postgres real en
// db/rls-falabella.test.ts.
const { requierePermisoMock, listarPedidosMock, detalleMlMock } = vi.hoisted(() => ({
  requierePermisoMock: vi.fn(),
  listarPedidosMock: vi.fn(),
  detalleMlMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "empresa-1" }) }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "usuario-1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "empresa-1", nombre: "Empresa" }] }));
vi.mock("@/lib/membresias", () => ({ obtenerMiMembresia: async () => null }));
vi.mock("@/lib/permisos", () => ({ requierePermiso: requierePermisoMock, SinPermisoError: class extends Error {} }));
vi.mock("@/lib/ml/cuentas", () => ({ obtenerCuentaMlActiva: async () => ({ id: "cuenta-ml-1" }) }));
vi.mock("@/components/finanzas/DetalleDiaCuentaProducto", () => ({
  DetalleDiaCuentaProducto: (props: { extra: Record<string, string> }) => {
    detalleMlMock(props);
    return <div data-prueba="detalle-ml">Mercado Libre · Tienda ML</div>;
  },
}));
vi.mock("@/lib/falabella/pedidos", () => ({ listarPedidosParaPantalla: listarPedidosMock }));
// PedidosFalabella es async (lee la base): se reemplaza por su tabla
// sincrónica real, con los datos que devuelve el mock de la lectura.
vi.mock("./PedidosFalabella", async (importOriginal) => {
  const real = await importOriginal<typeof import("./PedidosFalabella")>();
  return {
    ...real,
    PedidosFalabella: ({ empresaId, rango }: { empresaId: string; rango: { desde: Date; hastaExclusivo: Date } }) =>
      real.TablaPedidosFalabella(listarPedidosMock(empresaId, rango)),
  };
});

import PedidosPage from "./page";

const pedidoFalabella = {
  id: "f-1",
  pedidoIdExterno: "777001",
  fecha: new Date("2026-11-10T15:00:00Z"),
  total: "78000.00",
  moneda: "COP",
  estado: "pending",
  items: [{ Name: "Lámpara LED", Sku: "LAMP-1" }],
  cuenta: "zilonix falabella",
};

async function pintar(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await PedidosPage({ searchParams }));
}

describe("PedidosPage — filtro de marketplace (#422)", () => {
  beforeEach(() => {
    requierePermisoMock.mockResolvedValue(undefined);
    listarPedidosMock.mockReturnValue({ pedidos: [pedidoFalabella], truncado: false });
  });
  afterEach(() => vi.clearAllMocks());

  it("Todos (por defecto): la lista mezcla Mercado Libre y Falabella, cada una con su marketplace y cuenta", async () => {
    const html = await pintar({ desde: "2026-11-01", hasta: "2026-11-30" });

    expect(html).toContain('data-prueba="detalle-ml"');
    expect(html).toContain("Pedidos de Mercado Libre");
    expect(html).toContain("Pedidos de Falabella");
    expect(html).toContain("#777001");
    expect(html).toContain("Falabella</span> · zilonix falabella");
    expect(html).toContain("Lámpara LED");
    expect(html).toContain("SKU LAMP-1");
    // Comisión, envío y costo: Falabella no los trae, van con "—".
    expect(html.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
    // Respeta el filtro de fechas: el rango que llega a Falabella es el del mes pedido.
    const [, rango] = listarPedidosMock.mock.calls[0];
    expect(rango.desde.toISOString()).toBe("2026-11-01T05:00:00.000Z");
    expect(rango.hastaExclusivo.toISOString()).toBe("2026-12-01T05:00:00.000Z");
  });

  it("Mercado Libre: solo el detalle de ML, sin leer Falabella", async () => {
    const html = await pintar({ marketplace: "ml" });

    expect(html).toContain('data-prueba="detalle-ml"');
    expect(html).not.toContain("Pedidos de Falabella");
    expect(listarPedidosMock).not.toHaveBeenCalled();
    expect(detalleMlMock.mock.calls[0][0].extra).toEqual({ marketplace: "ml" });
  });

  it("Falabella: solo la tabla de Falabella, con su propio filtro de fechas", async () => {
    const html = await pintar({ marketplace: "falabella" });

    expect(html).not.toContain('data-prueba="detalle-ml"');
    expect(html).toContain("Pedidos de Falabella");
    expect(html).toContain('name="marketplace" value="falabella"');
    expect(listarPedidosMock).toHaveBeenCalledWith("empresa-1", expect.any(Object));
  });

  it("un marketplace desconocido en la URL cae a Todos", async () => {
    const html = await pintar({ marketplace: "amazon" });
    expect(html).toContain('data-prueba="detalle-ml"');
    expect(html).toContain("Pedidos de Falabella");
  });
});
