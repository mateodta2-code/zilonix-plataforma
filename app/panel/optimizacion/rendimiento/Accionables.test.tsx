// @vitest-environment jsdom
// «Qué hacer primero»: carga lazy, montos, permisos, descartar y marcar hecho.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { leerPeriodoLista } from "@/lib/optimizacion/periodoLista";
import { Accionables } from "./Accionables";
import type { FilaRendimiento } from "./TablaRendimiento";

const contextoMock = vi.fn();
const senalesMock = vi.fn();
const notaMock = vi.fn();
vi.mock("./actions", () => ({
  contextoAccionablesAction: (...a: unknown[]) => contextoMock(...a),
  senalesAccionablesAction: (...a: unknown[]) => senalesMock(...a),
}));
vi.mock("../actions", () => ({ guardarNotaBitacoraAction: (...a: unknown[]) => notaMock(...a) }));
vi.mock("next/link", () => ({ default: ({ children, href, className }: { children: React.ReactNode; href: string; className?: string }) => <a href={href} className={className}>{children}</a> }));

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  contextoMock.mockReset();
  senalesMock.mockReset();
  notaMock.mockReset();
});

const periodo = leerPeriodoLista({ dias: "30" }, new Date("2026-11-25T17:00:00Z"));
const fila = (n: number, extra: Partial<FilaRendimiento> = {}): FilaRendimiento => ({
  itemId: `MCO${n}`, titulo: `Pub ${n}`, foto: null, sku: null, grupo: "killer", porcentaje: 30, acumulado: 30,
  ingresos: 1000, ventas: 10, clics: 40, impresiones: 2000, ...extra,
});
const filas = [fila(1), fila(2), fila(3), fila(4, { clics: 10 })];
const visitas = Object.fromEntries(filas.map((f) => [f.itemId, 100]));
const props = (extra: Record<string, unknown> = {}) => ({
  filas, cuentaMlId: "c1", siteId: "MCO", idioma: "es", periodo, verMontos: true, consultaPeriodo: "dias=30",
  datos: { visitas, categorias: Object.fromEntries(filas.map((f) => [f.itemId, "C1"])), cargando: false }, ...extra,
});

describe("Accionables", () => {
  it("espera a que la tabla termine y no llama a ML mientras tanto", async () => {
    render(<Accionables {...props({ datos: { visitas: {}, categorias: {}, cargando: true } })} />);
    await act(async () => {});
    expect(contextoMock).not.toHaveBeenCalled();
    expect(screen.getByText("Esperando visitas y categorías…")).toBeTruthy();
  });

  it("muestra la tarjeta con monto y «Por qué», enlace con cuenta y período; lee ≤ 10 de a 3", async () => {
    contextoMock.mockResolvedValue({ ok: true, contexto: {}, avisos: [] });
    senalesMock.mockResolvedValue({ ok: true, senales: {} });
    render(<Accionables {...props()} />);
    await act(async () => {});
    expect(screen.getByText("Cambiar portada")).toBeTruthy();
    expect(screen.getByText(/Por qué:/)).toBeTruthy();
    expect(screen.getByText("Pub 4").closest("a")?.getAttribute("href")).toBe("/panel/optimizacion/MCO4?cuenta=c1&dias=30");
    expect(senalesMock).toHaveBeenCalledTimes(2); // 4 publicaciones, de a 3
    expect(senalesMock.mock.calls[0][0].ids).toHaveLength(3);
  });

  it("sin permiso de ventas no muestra montos", async () => {
    contextoMock.mockResolvedValue({ ok: true, contexto: {}, avisos: [] });
    senalesMock.mockResolvedValue({ ok: true, senales: {} });
    render(<Accionables {...props({ verMontos: false, filas: filas.map((f) => ({ ...f, ingresos: null })) })} />);
    await act(async () => {});
    expect(screen.getByText("Cambiar portada")).toBeTruthy();
    expect(screen.queryByText("Sin estimar")).toBeNull();
    expect(document.body.textContent).not.toMatch(/\$/);
  });

  it("descartar queda en sessionStorage", async () => {
    contextoMock.mockResolvedValue({ ok: true, contexto: {}, avisos: [] });
    senalesMock.mockResolvedValue({ ok: true, senales: {} });
    render(<Accionables {...props()} />);
    await act(async () => {});
    fireEvent.click(screen.getByText("Descartar"));
    expect(screen.queryByText("Cambiar portada")).toBeNull();
    expect(sessionStorage.getItem("zx-accionables-descartados")).toContain("c1|portada|MCO4");
  });

  it("«Ir a la publicación» lleva al bloque de edición del detalle, con cuenta y período", async () => {
    contextoMock.mockResolvedValue({ ok: true, contexto: {}, avisos: [] });
    senalesMock.mockResolvedValue({ ok: true, senales: {} });
    render(<Accionables {...props()} />);
    await act(async () => {});
    const href = screen.getByText("Ir a la publicación").closest("a")?.getAttribute("href") ?? "";
    expect(href).toMatch(/^\/panel\/optimizacion\/MCO4\?cuenta=c1/);
    expect(href.endsWith("#editar")).toBe(true);
  });

  it("marcar hecho guarda la nota «Accionable hecho: <tipo>» con la fecha de hoy", async () => {
    contextoMock.mockResolvedValue({ ok: true, contexto: {}, avisos: [] });
    senalesMock.mockResolvedValue({ ok: true, senales: {} });
    notaMock.mockResolvedValue({ ok: true, aviso: "Nota guardada" });
    render(<Accionables {...props()} />);
    await act(async () => {});
    await act(async () => {
      fireEvent.click(screen.getByText("Marcar hecho"));
    });
    expect(notaMock).toHaveBeenCalledWith(expect.objectContaining({ cuentaMlId: "c1", itemId: "MCO4", texto: "Accionable hecho: Cambiar portada", fecha: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });
});
