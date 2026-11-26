// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DetalleAlerta } from "./DetalleAlerta";

const moderacionMock = vi.fn();
vi.mock("./actions", () => ({ moderacionPublicacionAction: (...a: unknown[]) => moderacionMock(...a) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  moderacionMock.mockReset();
});

const base = { cuentaMlId: "c1", siteId: "MCO", idioma: "es-CO", filas: [{ id: "MCO1", titulo: "Funda" }] };

describe("DetalleAlerta", () => {
  it("precio alto: chip con precio de referencia y diferencia, con la moneda del sitio", () => {
    render(<DetalleAlerta {...base} clave="precio_alto" referencias={{ MCO1: { precioSugerido: 100000, diferenciaPorcentaje: 20 } }} />);
    expect(screen.getByText(/Precio de referencia: .*100\.000.* \(−20 %\)/)).toBeTruthy();
    expect(screen.getByText("Funda").closest("a")!.getAttribute("href")).toBe("/panel/optimizacion/MCO1?cuenta=c1");
  });

  it("competencia: chip del estado", () => {
    render(<DetalleAlerta {...base} clave="competencia" estados={{ MCO1: "competing" }} />);
    expect(screen.getByText("Compitiendo")).toBeTruthy();
  });

  it("moderadas: no llama a ML hasta abrir, y una sola vez", async () => {
    moderacionMock.mockResolvedValue({ ok: true, moderacion: { motivo: "Infringe políticas", solucion: "Edita el título", fecha: null } });
    render(<DetalleAlerta {...base} clave="moderadas" />);
    expect(moderacionMock).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByText("Conoce qué pasó")));
    expect(screen.getByText("Infringe políticas")).toBeTruthy();
    expect(screen.getByText("Edita el título")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByText("Conoce qué pasó")));
    await act(async () => fireEvent.click(screen.getByText("Conoce qué pasó")));
    expect(moderacionMock).toHaveBeenCalledTimes(1);
    expect(moderacionMock).toHaveBeenCalledWith({ cuentaMlId: "c1", itemId: "MCO1" });
  });

  it("moderadas: si ML no responde muestra el aviso", async () => {
    moderacionMock.mockResolvedValue({ ok: false, aviso: "No se pudo consultar Mercado Libre. Intenta de nuevo." });
    render(<DetalleAlerta {...base} clave="moderadas" />);
    await act(async () => fireEvent.click(screen.getByText("Conoce qué pasó")));
    expect(screen.getByText("No se pudo consultar Mercado Libre. Intenta de nuevo.")).toBeTruthy();
  });
});
