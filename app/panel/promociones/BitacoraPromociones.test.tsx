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
    detalle: { regla: "maximo", origen: "lote", ok: true, status: 200, respuesta: null },
    error: null,
    ...extra,
  };
}

function mockFetch(filas: unknown[]) {
  const fn = vi.fn(async () => ({ ok: true, json: async () => ({ filas, hayMas: false }) }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("BitacoraPromociones", () => {
  it("muestra quién, regla, acción y resultado de cada fila", async () => {
    mockFetch([fila(), fila({ id: "a2", accion: "salir", estado: "fallida", error: "ML dijo no", detalle: { regla: "salir", origen: "participando", ok: false, status: 400, respuesta: null } })]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getAllByText("Ana")).toHaveLength(2));
    expect(screen.getByText("Máximo")).toBeTruthy();
    const celdas = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(celdas).toContain("Entró");
    expect(celdas).toContain("Salió");
    expect(celdas.some((c) => c === "OK")).toBe(true);
    expect(celdas.some((c) => c?.startsWith("Error"))).toBe(true);
    expect(screen.getByText(/ML dijo no/)).toBeTruthy();
  });

  it("distingue las acciones simuladas", async () => {
    mockFetch([fila({ modoSimulacion: true })]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText("Simulado")).toBeTruthy());
  });

  it("los filtros viajan como parámetros al endpoint y reinician la página", async () => {
    const fn = mockFetch([fila()]);
    render(<BitacoraPromociones cuentas={CUENTAS} />);
    await waitFor(() => expect(screen.getByText("Zapato")).toBeTruthy());
    fireEvent.change(screen.getByLabelText("Acción"), { target: { value: "salir" } });
    fireEvent.change(screen.getByLabelText("Resultado"), { target: { value: "error" } });
    fireEvent.change(screen.getByLabelText("Desde"), { target: { value: "2026-01-01" } });
    await waitFor(() => {
      const url = String((fn.mock.calls.at(-1) as unknown[])[0]);
      expect(url).toContain("accion=salir");
      expect(url).toContain("resultado=error");
      expect(url).toContain("desde=2026-01-01");
      expect(url).toContain("pagina=1");
    });
  });
});
