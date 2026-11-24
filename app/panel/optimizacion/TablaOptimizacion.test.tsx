// @vitest-environment jsdom
// Barra-C (Refs #619): avance real por tandas en Optimización, con un fake de las tandas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { TablaOptimizacion, type FilaTablaOptimizacion } from "./TablaOptimizacion";

const metricasMock = vi.fn();
vi.mock("./actions", () => ({
  metricasPublicacionesAction: (...a: unknown[]) => metricasMock(...a),
  cambiarEstadoPublicacionAction: vi.fn(),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  metricasMock.mockReset();
});

const fila = (n: number): FilaTablaOptimizacion => ({
  id: `MCO${n}`, titulo: `P${n}`, foto: null, enlace: null, estado: "active", precio: 1000, precioOriginal: null,
  tipoPublicacion: null, envioGratis: false, full: false, catalogo: false, sku: null, ventas: null,
});
const filas = Array.from({ length: 25 }, (_, i) => fila(i));
const props = { cuentaMlId: "c1", siteId: "MCO", idioma: "es", puedeModificar: false, dias: 30 };

describe("TablaOptimizacion · BarraCarga", () => {
  it("avanza por tandas y termina en «Datos completos»", async () => {
    const pendientes: Array<(v: unknown) => void> = [];
    metricasMock.mockImplementation(() => new Promise((res) => pendientes.push(res)));
    render(<TablaOptimizacion filas={filas} {...props} />);
    expect(screen.getByText("Trayendo visitas, calidad y competencia…")).toBeTruthy();
    expect(screen.getByText("0 de 25 publicaciones (0 %)")).toBeTruthy();
    await act(async () => pendientes[0]({ ok: true, metricas: {} }));
    expect(screen.getByText("10 de 25 publicaciones (40 %)")).toBeTruthy();
    await act(async () => pendientes[1]({ ok: true, metricas: {} }));
    await act(async () => pendientes[2]({ ok: true, metricas: {} }));
    expect(screen.getByText("Datos completos")).toBeTruthy();
    expect(metricasMock).toHaveBeenCalledTimes(3);
  });

  it("si se corta, queda detenida con el aviso y sin «Seguir cargando»", async () => {
    metricasMock.mockResolvedValue({ ok: false, aviso: "Mercado Libre no respondió." });
    render(<TablaOptimizacion filas={filas} {...props} />);
    await act(async () => {});
    expect(screen.getByText("Mercado Libre no respondió.")).toBeTruthy();
    expect(screen.queryByText("Seguir cargando")).toBeNull();
  });
});
