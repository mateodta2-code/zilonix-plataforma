// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import { BarraCarga } from "./BarraCarga";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BarraCarga", () => {
  it("con total: progressbar con valor y detalle", () => {
    render(<BarraCarga estado="cargando" titulo="Cargando… 50" avance={{ hechos: 50, total: 200 }} unidad="revisadas" />);
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25");
    expect(screen.getByText(/50 de 200 revisadas \(25 %\)/)).toBeTruthy();
  });

  it("sin total: indeterminada sin progressbar", () => {
    render(<BarraCarga estado="cargando" titulo="Cargando…" avance={null} />);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("completa queda al 100 % y se oculta a los 4 s", () => {
    vi.useFakeTimers();
    render(<BarraCarga estado="completa" titulo="x" textoInactiva="Listo" />);
    expect(screen.getByText("Carga completa")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.queryByText("Carga completa")).toBeNull();
    expect(screen.getByText("Listo")).toBeTruthy();
  });

  it("detenida muestra «Seguir cargando» y llama al callback", () => {
    const seguir = vi.fn();
    render(<BarraCarga estado="detenida" titulo="x" textoDetenida="Carga detenida" alSeguir={seguir} />);
    expect(screen.getByText("Carga detenida")).toBeTruthy();
    fireEvent.click(screen.getByText("Seguir cargando"));
    expect(seguir).toHaveBeenCalled();
  });

  it("botón de acción llama al callback y role=status existe", () => {
    const detener = vi.fn();
    render(<BarraCarga estado="cargando" titulo="x" accion={{ texto: "Detener carga", onClick: detener }} />);
    fireEvent.click(screen.getByText("Detener carga"));
    expect(detener).toHaveBeenCalled();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
