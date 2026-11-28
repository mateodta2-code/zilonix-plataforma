// @vitest-environment jsdom
//
// Issue "historial de Publicar — detalle en español, in-place" —
// mismo patrón que TarjetaDespachoCliente.test.tsx (@testing-library/react
// + jsdom, fetch mockeado con vi.stubGlobal). Cubre: desplegar/ocultar
// sin navegar, varias cuentas con estados mezclados, y que "ver
// detalle" nunca es un <a>/<Link> real.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { HistorialPublicaciones, INTERVALO_SONDEO_MS, TOPE_SONDEO_MS, type ProductoHistorial } from "./HistorialPublicaciones";
import type { Cuenta } from "./CuentasDestino";

vi.mock("./actions", () => ({ borrarProductoAction: vi.fn() }));
vi.mock("./falabella-actions", () => ({
  aprobarFalabellaAction: vi.fn(),
  atributosFalabellaAction: vi.fn(),
  avanzarFalabellaAction: vi.fn(),
  corregirFalabellaAction: vi.fn(),
  descartarFalabellaAction: vi.fn(),
  estadoRealFalabellaAction: vi.fn(),
}));
const { refrescar } = vi.hoisted(() => ({ refrescar: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refrescar }) }));

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

// Barra-A — sondeo de avance con fake timers.
describe("HistorialPublicaciones — barra de avance (Barra-A)", () => {
  const ok = (cuerpo: unknown) => ({ ok: true, json: async () => cuerpo }) as Response;

  function montar(productos: ProductoHistorial[]) {
    return render(<HistorialPublicaciones productos={productos} cuentas={cuentas} onCargar={vi.fn()} onDuplicar={vi.fn()} />);
  }
  function visibilidad(valor: "visible" | "hidden") {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => valor });
    document.dispatchEvent(new Event("visibilitychange"));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    refrescar.mockClear();
    visibilidad("visible");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sin publicaciones en curso no hay ninguna petición periódica", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    montar([productoBase()]);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("muestra 'N de M cuentas', avanza sola, y al terminar avisa, para el sondeo y refresca una vez", async () => {
    const respuestas = [
      { estado: "publicando", hechos: 1, total: 2 },
      { estado: "publicado", hechos: 2, total: 2 },
    ];
    const fetchMock = vi.fn(async (_url: string) => ok(respuestas.shift() ?? { estado: "publicado", hechos: 2, total: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = montar([productoBase({ estado: "publicando" })]);

    await vi.advanceTimersByTimeAsync(0);
    expect(screen.getByText(/1 de 2 cuentas/)).toBeTruthy();
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/ml/publicar/estado-publicacion?id=p1");

    await vi.advanceTimersByTimeAsync(INTERVALO_SONDEO_MS);
    expect(screen.getByText(/Publicación terminada · 2 de 2 cuentas exitosas/)).toBeTruthy();
    expect(refrescar).toHaveBeenCalledTimes(1);

    // La fila llega ya terminada (router.refresh): no se consulta más.
    rerender(<HistorialPublicaciones productos={[productoBase({ estado: "publicado" })]} cuentas={cuentas} onCargar={vi.fn()} onDuplicar={vi.fn()} />);
    const llamadas = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(llamadas);
  });

  it("con la pestaña oculta no consulta y al volver reanuda", async () => {
    const fetchMock = vi.fn(async () => ok({ estado: "publicando", hechos: 0, total: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    montar([productoBase({ estado: "publicando" })]);
    await vi.advanceTimersByTimeAsync(0);
    visibilidad("hidden");
    const antes = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock.mock.calls.length).toBe(antes);
    visibilidad("visible");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock.mock.calls.length).toBe(antes + 1);
  });

  it("deja de consultar pasado el tope de seguridad y al desmontar", async () => {
    const fetchMock = vi.fn(async () => ok({ estado: "publicando", hechos: 0, total: 2 }));
    vi.stubGlobal("fetch", fetchMock);
    const { unmount } = montar([productoBase({ estado: "publicando" })]);
    await vi.advanceTimersByTimeAsync(TOPE_SONDEO_MS + 2 * INTERVALO_SONDEO_MS);
    const llamadas = fetchMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetchMock.mock.calls.length).toBe(llamadas);
    unmount();
  });
});

describe("historial único con Falabella", () => {
  it("muestra la fila de Falabella en la misma tabla con su etiqueta", () => {
    render(
      <HistorialPublicaciones
        productos={[]}
        cuentas={[]}
        onCargar={() => {}}
        onDuplicar={() => {}}
        falabella={[
          {
            id: "f1",
            cuenta: "zilonix falabella",
            cuentaId: "c1",
            sku: "FUL1234",
            titulo: "Producto de prueba",
            estado: "rechazado",
            errores: [],
            creadoTs: "2026-11-28T20:00:00Z",
            borrador: { sku: "FUL1234", titulo: "Producto de prueba", descripcion: "x", marca: "GENERICO", ean: "1", categoriaId: 1, precioNormal: 60000, precioOferta: 35000, ofertaDesde: "2026-11-28 15:00:00", ofertaHasta: "2026-12-28 15:00:00", stock: 1, bodega: "Bodega_envio_01", iva: "19", medidas: { largo: 25, ancho: 15, alto: 25, peso: 1 }, imagenes: [], atributos: {}, problemas: [], avisos: [] },
          },
        ]}
      />
    );
    expect(screen.getByText("Producto de prueba")).toBeTruthy();
    expect(screen.getByText("Falabella")).toBeTruthy();
    expect(screen.getByText(/Rechazado/)).toBeTruthy();
  });
});
