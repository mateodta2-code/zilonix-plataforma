// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BitacoraPromociones } from "./BitacoraPromociones";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const CUENTAS = [{ id: "c1", nickname: "TIENDA1", siteId: "MCO" }];

function fila(extra: Record<string, unknown> = {}) {
  return {
    id: "a1",
    cuentaMlId: "c1",
    nicknameCuenta: "TIENDA1",
    itemId: "MCO123",
    tituloProducto: "Zapato",
    tipoPromocion: "DEAL",
    promotionIdMl: "P-9",
    accion: "participar",
    precioAntes: "100000",
    precioDespues: "90000",
    estado: "ejecutada",
    ejecutadoPorNombre: "Ana",
    ejecutadoTs: "2026-01-02T15:00:00Z",
    creadoTs: "2026-01-02T15:00:00Z",
    modoSimulacion: false,
    detalle: DETALLE,
    error: null,
    ...extra,
  };
}

const DETALLE = { regla: "maximo", origen: "lote", ok: true, status: 200, respuesta: null, lote: "11111111-1111-4111-8111-111111111111", maximoPct: 20, limite: "tope", sku: "SKU-1", nombrePromocion: "Campaña tradicional", motivo: null };

function tanda(extra: Record<string, unknown> = {}) {
  return { clave: "11111111-1111-4111-8111-111111111111", total: 3, participo: 1, modifico: 0, salio: 0, conError: 1, omitidas: 1, noApi: 0, simulada: false, regla: "maximo", usuarioNombre: "Ana", cuentaMlId: "c1", nicknameCuenta: "TIENDA1", fecha: "2026-01-02T15:00:00Z", ...extra };
}

function mockFetch(tandas: unknown[], filas: unknown[] = []) {
  const fn = vi.fn(async (url: string) => ({ ok: true, json: async () => (String(url).includes("lote=") ? { filas, hayMas: false } : { tandas, hayMas: false }) }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("BitacoraPromociones", () => {
  it("muestra el encabezado de la tanda con usuario y conteos", async () => {
    mockFetch([tanda()]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText("Ana", { exact: false })).toBeTruthy());
    expect(screen.getByText(/3 por revisar: 1 con error, 1 omitidas/)).toBeTruthy();
  });

  it("al desplegar carga las filas de la tanda con todas las columnas", async () => {
    const fn = mockFetch(
      [tanda()],
      [
        fila({ detalle: DETALLE }),
        fila({ id: "a2", estado: "rechazada", precioDespues: null, error: null, detalle: { ...DETALLE, regla: "salir", limite: "ml", motivo: "No se puede salir por API" } }),
        fila({ id: "a3", estado: "fallida", error: "ML dijo no", detalle: DETALLE }),
      ]
    );
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByRole("button", { expanded: false })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await waitFor(() => expect(screen.getAllByText("Zapato", { exact: false })).toHaveLength(3));
    expect(String((fn.mock.calls.at(-1) as unknown[])[0])).toContain("lote=11111111-1111-4111-8111-111111111111");
    const celdas = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(celdas).toContain("Participó");
    expect(celdas).toContain("No se puede por API");
    expect(celdas).toContain("Error");
    expect(celdas).toContain("Máximo 20 %");
    expect(celdas).toContain("Tope %");
    expect(celdas.some((c) => c?.includes("SKU-1"))).toBe(true);
    expect(celdas.some((c) => c?.startsWith("Campaña tradicional"))).toBe(true);
    expect(screen.getByText(/ML dijo no/)).toBeTruthy();
  });

  it("muestra piso, precio real y diferencia en las filas que quedaron por debajo del piso", async () => {
    mockFetch([tanda({ total: 1, conError: 0, omitidas: 0, bajoPiso: 1 })], [fila({ precioDespues: "99900", bajoPiso: { piso: 111000, precio: 99900, diferencia: -11100 } })]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText(/1 por revisar: 1 por debajo del piso/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { expanded: false }));
    await waitFor(() => expect(screen.getByText("Por debajo del piso", { selector: "span,div,small,td" })).toBeTruthy());
    expect(screen.getByText(/Quedó por debajo del piso actual \(piso .*111.*000.*precio .*99.*900.*diferencia .*11.*100/)).toBeTruthy();
  });

  it("sin nada que auditar muestra un mensaje claro", async () => {
    mockFetch([]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText(/No hay nada que auditar/)).toBeTruthy());
  });

  it("el filtro Resultado solo ofrece los estados que aplican", async () => {
    mockFetch([tanda()]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText("Ana", { exact: false })).toBeTruthy());
    const opciones = Array.from((screen.getByLabelText("Resultado") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(opciones).toEqual(["Todos", "No aplicada", "Error", "Por debajo del piso"]);
  });

  it("distingue las tandas simuladas", async () => {
    mockFetch([tanda({ simulada: true })]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText("Simulado")).toBeTruthy());
  });

  it("los filtros viajan como parámetros al endpoint y reinician la página", async () => {
    const fn = mockFetch([tanda()]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText("Ana", { exact: false })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Acción"), { target: { value: "salir" } });
    fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "error" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } });
    await waitFor(() => {
      const url = String((fn.mock.calls.at(-1) as unknown[])[0]);
      expect(url).toContain("vista=auditar");
      expect(url).toContain("accion=salir");
      expect(url).toContain("resultado=error");
      expect(url).toContain("desde=2026-01-01");
      expect(url).toContain("pagina=1");
    });
  });
});
