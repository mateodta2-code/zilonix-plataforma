// @vitest-environment jsdom
// Optimización · Rendimiento: carga por tandas (máx. 100, de a 3), semáforos con mediana y tope de % Ads.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { leerPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { elegirCandidatas, TablaRendimiento, type FilaRendimiento } from "./TablaRendimiento";

const categoriasMock = vi.fn();
const visitasMock = vi.fn();
vi.mock("./actions", () => ({
  categoriasRendimientoAction: (...a: unknown[]) => categoriasMock(...a),
  visitasRendimientoAction: (...a: unknown[]) => visitasMock(...a),
}));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));

afterEach(() => {
  cleanup();
  categoriasMock.mockReset();
  visitasMock.mockReset();
});

const periodo = leerPeriodoLista({ dias: "30" }, new Date("2026-11-25T17:00:00Z"));
const props = { cuentaMlId: "c1", siteId: "MCO", idioma: "es", periodo, grupo: null };

const fila = (n: number, extra: Partial<FilaRendimiento> = {}): FilaRendimiento => ({
  itemId: `MCO${n}`, titulo: `Pub ${n}`, foto: null, sku: null, grupo: "killer", porcentaje: 100 - n * 0.1, acumulado: 50,
  ingresos: 1000 * (200 - n), ventas: 2, clics: 10, impresiones: 2000, ...extra,
});

describe("elegirCandidatas", () => {
  it("máximo 100: las de más ingresos y, a igualdad, las de más impresiones", () => {
    const filas = Array.from({ length: 130 }, (_, i) => fila(i));
    const c = elegirCandidatas(filas);
    expect(c).toHaveLength(100);
    expect(c[0]).toBe("MCO0");
    expect(c).not.toContain("MCO129");
    const empate = elegirCandidatas([fila(1, { porcentaje: 0, impresiones: 5 }), fila(2, { porcentaje: 0, impresiones: 50 })]);
    expect(empate).toEqual(["MCO2", "MCO1"]);
  });
});

describe("TablaRendimiento", () => {
  it("pide categorías una vez y visitas de a 3, con barra «N de M»", async () => {
    const pendientes: Array<(v: unknown) => void> = [];
    categoriasMock.mockResolvedValue({ ok: true, categorias: {} });
    visitasMock.mockImplementation(() => new Promise((res) => pendientes.push(res)));
    const filas = Array.from({ length: 7 }, (_, i) => fila(i));
    render(<TablaRendimiento filas={filas} {...props} />);
    await act(async () => {});
    expect(categoriasMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText("0 de 7 publicaciones (0 %)")).toBeTruthy();
    await act(async () => pendientes[0]({ ok: true, visitas: {} }));
    expect(screen.getByText("3 de 7 publicaciones (43 %)")).toBeTruthy();
    expect(visitasMock.mock.calls[0][0].ids).toHaveLength(3);
    await act(async () => pendientes[1]({ ok: true, visitas: {} }));
    await act(async () => pendientes[2]({ ok: true, visitas: {} }));
    expect(visitasMock).toHaveBeenCalledTimes(3);
    expect(visitasMock.mock.calls[2][0].ids).toHaveLength(1);
    expect(screen.getByText("Datos completos")).toBeTruthy();
  });

  it("si Mercado Libre falla la página no se cae: queda detenida con aviso y la tabla visible", async () => {
    categoriasMock.mockRejectedValue(new Error("boom"));
    render(<TablaRendimiento filas={[fila(1)]} {...props} />);
    await act(async () => {});
    expect(screen.getByText(/No se pudieron traer visitas y categorías/)).toBeTruthy();
    expect(screen.getByText("Pub 1")).toBeTruthy();
  });

  it("% Ads tope 100 % con aviso de no concilia; conversión con 0 ventas; sin Ads", async () => {
    categoriasMock.mockResolvedValue({ ok: true, categorias: {} });
    visitasMock.mockResolvedValue({ ok: true, visitas: { MCO1: 100, MCO2: 100, MCO3: 100, MCO4: 100 } });
    const filas = [
      fila(1, { clics: 250, impresiones: 5000, ventas: 0 }),
      fila(2, { clics: 5, impresiones: 5000, ventas: 5 }),
      fila(3, { clics: 5, impresiones: 5000, ventas: 5 }),
      fila(4, { clics: 5, impresiones: 5000, ventas: 5 }),
    ];
    render(<TablaRendimiento filas={filas} {...props} />);
    await act(async () => {});
    expect(screen.getByText("100 %")).toBeTruthy();
    expect(screen.getByText("Ads reporta más clics que visitas: no concilia")).toBeTruthy();
    // MCO1: 0 ventas ÷ 100 visitas = 0 % frente a la mediana 5 % → peligro
    expect(screen.getAllByText(/^Bajo · mediana de la cuenta/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^(10[1-9]|1[1-9]\d|[2-9]\d{2}|\d{4,}) %$/)).toBeNull();
  });

  it("sin Product Ads las columnas dicen «Sin Ads»", async () => {
    categoriasMock.mockResolvedValue({ ok: true, categorias: {} });
    visitasMock.mockResolvedValue({ ok: true, visitas: {} });
    render(<TablaRendimiento filas={[fila(1, { clics: null, impresiones: null })]} {...props} />);
    await act(async () => {});
    expect(screen.getAllByText("Sin Ads")).toHaveLength(4);
  });

  it("sin permiso de montos no muestra moneda; filtra por grupo y ordena", async () => {
    categoriasMock.mockResolvedValue({ ok: true, categorias: {} });
    visitasMock.mockResolvedValue({ ok: true, visitas: {} });
    const filas = [fila(1, { ingresos: null }), fila(2, { ingresos: null, grupo: "cola", porcentaje: 1 })];
    const { container, rerender } = render(<TablaRendimiento filas={filas} {...props} />);
    await act(async () => {});
    expect(container.textContent).not.toMatch(/\$/);
    rerender(<TablaRendimiento filas={filas} {...props} grupo="cola" />);
    expect(screen.queryByText("Pub 1")).toBeNull();
    expect(screen.getByText("Pub 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Ingresos/ }));
    expect(screen.getByRole("button", { name: /Ingresos/ }).textContent).toContain("↑");
  });

  it("pagina de a 50", async () => {
    categoriasMock.mockResolvedValue({ ok: true, categorias: {} });
    visitasMock.mockResolvedValue({ ok: true, visitas: {} });
    const filas = Array.from({ length: 120 }, (_, i) => fila(i));
    render(<TablaRendimiento filas={filas} {...props} />);
    await act(async () => {});
    expect(screen.getByText("Página 1 de 3")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(51);
    fireEvent.click(screen.getByText("Siguiente →"));
    expect(screen.getByText("Página 2 de 3")).toBeTruthy();
  });
});
