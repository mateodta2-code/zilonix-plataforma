import { randomUUID } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// Bug real en vivo (digest 960283135, staging): Clerk deja /sso-callback
// colgado bajo esta ruta dinámica — "sso-callback" se cuela como si
// fuera params.id, y pedidos.id es uuid: eq(pedidos.id, "sso-callback")
// revienta Postgres con 22P02 en vez de un redirect normal, mostrando
// "Application error". Esta prueba confirma el arreglo en el lugar
// exacto donde pasaba el bug (la página, no solo el helper de datos):
// el guard de esUuid() corta en la primera línea, ANTES de tocar auth o
// la base — ni siquiera obtenerOCrearUsuarioActual() se llega a llamar.
//
// vi.hoisted(): vi.mock() se adelanta al tope del archivo (hoisting de
// vitest) — sin esto, las referencias a estos mocks dentro de los
// factory de abajo revientan con "Cannot access ... before initialization".
const {
  redirectMock,
  cookiesGetMock,
  obtenerOCrearUsuarioActualMock,
  listarEmpresasDeUsuarioMock,
  obtenerMiMembresiaMock,
  requierePermisoMock,
  SinPermisoErrorFalso,
  obtenerPedidoConEventosMock,
  tienePermisoMock,
  tieneVentaFinanzasMock,
} = vi.hoisted(() => {
  class SinPermisoErrorFalso extends Error {}
  return {
    redirectMock: vi.fn((url: string) => {
      // Mismo comportamiento real de next/navigation: redirect() nunca
      // "devuelve", corta la ejecución lanzando — si no lo simuláramos
      // así, el resto de la función seguiría corriendo con datos a
      // medio cargar.
      throw new Error(`NEXT_REDIRECT:${url}`);
    }),
    cookiesGetMock: vi.fn(() => ({ value: "empresa-1" })),
    obtenerOCrearUsuarioActualMock: vi.fn(),
    listarEmpresasDeUsuarioMock: vi.fn(),
    obtenerMiMembresiaMock: vi.fn(),
    requierePermisoMock: vi.fn(),
    SinPermisoErrorFalso,
    obtenerPedidoConEventosMock: vi.fn(),
    tienePermisoMock: vi.fn(() => false),
    tieneVentaFinanzasMock: vi.fn(),
  };
});

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: cookiesGetMock }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: obtenerOCrearUsuarioActualMock }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: listarEmpresasDeUsuarioMock }));
vi.mock("@/lib/membresias", () => ({ obtenerMiMembresia: obtenerMiMembresiaMock }));
vi.mock("@/lib/permisos", () => ({ requierePermiso: requierePermisoMock, SinPermisoError: SinPermisoErrorFalso }));
vi.mock("@/lib/roles", () => ({ tienePermiso: tienePermisoMock }));
vi.mock("@/lib/finanzas/ventas-consulta", () => ({ tieneVentaFinanzas: tieneVentaFinanzasMock }));
vi.mock("@/lib/ml/pedidos", () => ({
  obtenerPedidoConEventos: obtenerPedidoConEventosMock,
  etiquetaEstadoPedido: (estado: string) => estado,
  PASOS_PEDIDO: ["venta", "pago", "factura", "empaque", "despacho", "entrega", "novedades", "dinero_conciliado"],
}));

import PedidoDetallePage from "./page";

describe("PedidoDetallePage — guard de esUuid antes de tocar la base (digest 960283135)", () => {
  afterEach(() => vi.clearAllMocks());

  it('id sin forma de UUID (ej. "sso-callback"): redirect a /panel/pedidos, nunca llega a tocar auth/DB', async () => {
    await expect(PedidoDetallePage({ params: { id: "sso-callback" } })).rejects.toThrow("NEXT_REDIRECT:/panel/pedidos");
    expect(redirectMock).toHaveBeenCalledWith("/panel/pedidos");
    // La prueba real del bug: ni siquiera se llega a averiguar quién es
    // el usuario — el guard corta antes de la primera línea que toca algo.
    expect(obtenerOCrearUsuarioActualMock).not.toHaveBeenCalled();
    expect(obtenerPedidoConEventosMock).not.toHaveBeenCalled();
  });

  it("UUID válido: pasa el guard sin redirect y sigue el flujo normal hasta traer el pedido", async () => {
    const pedidoId = randomUUID();
    obtenerOCrearUsuarioActualMock.mockResolvedValue({ id: "usuario-1" });
    listarEmpresasDeUsuarioMock.mockResolvedValue([{ id: "empresa-1", nombre: "Empresa Test", nit: "123" }]);
    requierePermisoMock.mockResolvedValue({ rolNombre: "Dueño", permisos: [] });
    obtenerPedidoConEventosMock.mockResolvedValue({
      pedido: { pedidoIdExterno: "ORD-1", moneda: "COP", total: "50000", estado: "paid" },
      eventos: [],
    });

    const resultado = await PedidoDetallePage({ params: { id: pedidoId } });

    expect(redirectMock).not.toHaveBeenCalled();
    expect(obtenerOCrearUsuarioActualMock).toHaveBeenCalled();
    expect(obtenerPedidoConEventosMock).toHaveBeenCalledWith("empresa-1", pedidoId);
    expect(resultado).toBeTruthy();
  });
});
