// @vitest-environment jsdom
//
// Issue "historial de Publicar — detalle en español, in-place" —
// mismo patrón que TarjetaDespachoCliente.test.tsx (@testing-library/react
// + jsdom, fetch mockeado con vi.stubGlobal). Cubre: desplegar/ocultar
// sin navegar, varias cuentas con estados mezclados, y que "ver
// detalle" nunca es un <a>/<Link> real.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistorialPublicaciones, type ProductoHistorial } from "./HistorialPublicaciones";
import type { Cuenta } from "./CuentasDestino";

vi.mock("./actions", () => ({ borrarProductoAction: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cuentas: Cuenta[] = [
  { id: "c1", nickname: "Tienda Uno", siteId: "MCO", moneda: "COP", idioma: "es-CO" },
  { id: "c2", nickname: "Tienda Dos", siteId: "MCO", moneda: "COP", idioma: "es-CO" },
];

function productoBase(extra: Partial<ProductoHistorial> = {}): ProductoHistorial {
  return {
    id: "p1",
    titulo: "Producto de prueba",
    estado: "publicado",
    creadoTs: "2026-11-01T10:00:00Z",
    precio: "10000",
    stock: 1,
    condicion: "new",
    envioGratis: false,
    sku: null,
    dimensiones: {},
    imagenes: [],
    atributosExtra: {},
    categoriasOverride: {},
    variantes: null,
    porCuenta: {},
    cuentasSeleccionadas: ["c1", "c2"],
    resultado: null,
    modoPrueba: false,
    ...extra,
  };
}

describe("HistorialPublicaciones — detalle in-place (nunca navega)", () => {
  it("sin resultado, 'ver detalle' despliega la fila y 'ocultar' la cierra, sin ningún <a href> de navegación", () => {
    const producto = productoBase({
      resultado: [
        { cuentaMlId: "c1", ok: true, itemId: "MCO1", permalink: "https://articulo.mercadolibre.com.co/MCO-1", categoria: "X", atributosAsumidos: [], status: "paused", modoPrueba: false, avisoFotosVariante: null, avisoMarca: null, avisoDescripcion: null },
      ],
    });
    render(<HistorialPublicaciones productos={[producto]} cuentas={cuentas} onCargar={vi.fn()} onDuplicar={vi.fn()} />);

    const boton = screen.getByText("ver detalle");
    expect(boton.tagName).toBe("BUTTON");
    expect(boton.closest("a")).toBeNull();

    fireEvent.click(boton);
    expect(screen.getByText("Tienda Uno")).not.toBeNull();
    expect(screen.getByText("Publicado (sin verificar)")).not.toBeNull();
    expect(screen.getByText("ocultar")).not.toBeNull();

    fireEvent.click(screen.getByText("ocultar"));
    expect(screen.queryByText("Tienda Uno")).toBeNull();
    expect(screen.getByText("ver detalle")).not.toBeNull();
  });

  it("varias cuentas con estados mezclados: cada una muestra su propio motivo o link, nunca un texto en inglés", () => {
    const producto = productoBase({
      resultado: [
        { cuentaMlId: "c1", ok: true, itemId: "MCO1", permalink: "https://articulo.mercadolibre.com.co/MCO-1", categoria: "X", atributosAsumidos: [], status: "active", modoPrueba: false, avisoFotosVariante: null, avisoMarca: null, avisoDescripcion: null },
        { cuentaMlId: "c2", ok: false, error: "Mercado Libre rechazó la publicación" },
      ],
    });
    render(<HistorialPublicaciones productos={[producto]} cuentas={cuentas} onCargar={vi.fn()} onDuplicar={vi.fn()} />);
    fireEvent.click(screen.getByText("ver detalle"));

    expect(screen.getByText("Tienda Uno")).not.toBeNull();
    expect(screen.getByText("Tienda Dos")).not.toBeNull();
    expect(screen.getByText("Mercado Libre rechazó la publicación")).not.toBeNull();
    expect(screen.getByText("Ver publicación ↗").closest("a")).toHaveProperty("target", "_blank");
    // la cuenta fallida nunca tiene botón "Ver estado real" (nunca tuvo itemId real)
    expect(screen.getAllByText("Ver estado real")).toHaveLength(1);
  });

  it("'Ver estado real' consulta la ruta sin recargar la página y traduce el status real al español", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ status: "active" }) }));
    const producto = productoBase({
      resultado: [
        { cuentaMlId: "c1", ok: true, itemId: "MCO1", permalink: "https://articulo.mercadolibre.com.co/MCO-1", categoria: "X", atributosAsumidos: [], status: "paused", modoPrueba: false, avisoFotosVariante: null, avisoMarca: null, avisoDescripcion: null },
      ],
    });
    render(<HistorialPublicaciones productos={[producto]} cuentas={cuentas} onCargar={vi.fn()} onDuplicar={vi.fn()} />);
    fireEvent.click(screen.getByText("ver detalle"));
    expect(screen.getByText("Publicado (sin verificar)")).not.toBeNull();

    fireEvent.click(screen.getByText("Ver estado real"));
    expect(await screen.findByText("Publicado y activo")).not.toBeNull();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/ml/publicar/estado-item?cuentaId=c1&itemId=MCO1"));
  });
});
