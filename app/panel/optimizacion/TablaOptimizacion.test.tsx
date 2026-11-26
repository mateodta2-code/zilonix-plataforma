// @vitest-environment jsdom
// Barra-C (Refs #619): avance real por tandas en Optimización, con un fake de las tandas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { leerPeriodoLista } from "@/lib/optimizacion/periodoLista";
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

const AHORA = new Date("2026-11-25T17:00:00Z");

const fila = (n: number): FilaTablaOptimizacion => ({
  id: `MCO${n}`, titulo: `P${n}`, foto: null, enlace: null, estado: "active", precio: 1000, precioOriginal: null,
  tipoPublicacion: null, envioGratis: false, full: false, catalogo: false, sku: null, ventas: null,
});
const filas = Array.from({ length: 25 }, (_, i) => fila(i));
const props = { cuentaMlId: "c1", siteId: "MCO", idioma: "es", puedeModificar: false, periodo: leerPeriodoLista({ dias: "30" }, AHORA) };
const hoy = leerPeriodoLista({ periodo: "hoy" }, AHORA);
const rango = leerPeriodoLista({ desde: "2026-11-01", hasta: "2026-11-15" }, AHORA);

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

describe("TablaOptimizacion · período", () => {
  it("los 30 días de siempre: encabezados «30 d» y la acción recibe dias", async () => {
    metricasMock.mockResolvedValue({ ok: true, metricas: {} });
    render(<TablaOptimizacion filas={filas.slice(0, 2)} {...props} />);
    await act(async () => {});
    expect(screen.getByText("Visitas 30 d")).toBeTruthy();
    expect(screen.getByText("Ventas 30 d")).toBeTruthy();
    expect(metricasMock).toHaveBeenCalledWith(expect.objectContaining({ dias: 30 }));
    expect(screen.queryByText(/pueden tardar unas horas/)).toBeNull();
  });

  it("«Hoy»: encabezados «hoy», fechas a la acción y la nota de demora", async () => {
    metricasMock.mockResolvedValue({ ok: true, metricas: {} });
    render(<TablaOptimizacion filas={filas.slice(0, 2)} {...props} periodo={hoy} />);
    await act(async () => {});
    expect(screen.getByText("Visitas hoy")).toBeTruthy();
    expect(screen.getByText("Ventas hoy")).toBeTruthy();
    expect(metricasMock).toHaveBeenCalledWith(expect.objectContaining({ periodo: { desde: "2026-11-25", hasta: "2026-11-25" } }));
    expect(screen.getByText("Las visitas de hoy pueden tardar unas horas en aparecer en Mercado Libre.")).toBeTruthy();
  });

  it("rango: encabezado con las fechas, y recarga al cambiar el período", async () => {
    metricasMock.mockResolvedValue({ ok: true, metricas: {} });
    const { rerender } = render(<TablaOptimizacion filas={filas.slice(0, 2)} {...props} periodo={rango} />);
    await act(async () => {});
    expect(screen.getByText("Visitas 1–15 nov")).toBeTruthy();
    expect(metricasMock).toHaveBeenLastCalledWith(expect.objectContaining({ periodo: { desde: "2026-11-01", hasta: "2026-11-15" } }));
    const antes = metricasMock.mock.calls.length;
    rerender(<TablaOptimizacion filas={filas.slice(0, 2)} {...props} periodo={hoy} />);
    await act(async () => {});
    expect(metricasMock.mock.calls.length).toBeGreaterThan(antes);
  });
});

describe("TablaOptimizacion · Experiencia y Recomendaciones", () => {
  const base = { visitas: 1, calidad: { puntaje: 70, nivel: "Estándar", pendientes: ["a", "b"] }, competencia: null };
  it("muestra experiencia, hasta 2 chips con «+N» al detalle con cuenta y período, y «N objetivos pendientes»", async () => {
    metricasMock.mockResolvedValue({
      ok: true,
      metricas: {
        MCO0: { ...base, experiencia: { color: "green", texto: "Buena" }, recomendaciones: [{ clave: "1", texto: "Uno" }, { clave: "2", texto: "Dos" }, { clave: "3", texto: "Tres" }] },
        MCO1: { ...base, experiencia: null, recomendaciones: [] },
      },
    });
    render(<TablaOptimizacion filas={filas.slice(0, 2)} {...props} periodoParams={{ dias: "30" }} />);
    await act(async () => {});
    expect(screen.getByText("Buena")).toBeTruthy();
    expect(screen.getByText("Uno")).toBeTruthy();
    expect(screen.getByText("Dos")).toBeTruthy();
    expect(screen.queryByText("Tres")).toBeNull();
    expect(screen.getByText("+1").closest("a")?.getAttribute("href")).toBe("/panel/optimizacion/MCO0?cuenta=c1&dias=30");
    expect(screen.getByText("Sin acciones")).toBeTruthy();
    expect(screen.getAllByText("2 objetivos pendientes").length).toBe(2);
  });
});
