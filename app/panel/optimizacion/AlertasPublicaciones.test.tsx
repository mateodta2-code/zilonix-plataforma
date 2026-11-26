// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AlertasPublicaciones } from "./AlertasPublicaciones";

const alertasMock = vi.fn();
vi.mock("./actions", () => ({ alertasPublicacionesAction: (...a: unknown[]) => alertasMock(...a) }));
vi.mock("next/link", () => ({
  default: ({ children, href, scroll: _scroll, ...r }: { children: React.ReactNode; href: string; scroll?: boolean }) => (
    <a href={href} {...r}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  alertasMock.mockReset();
});

const TEXTOS = {
  moderadas: { titulo: "Inactivas por incumplir políticas", texto: "Conoce qué pasó para evitar nuevas infracciones." },
  competencia: { titulo: "Para ganar la competencia en Mercado Libre", texto: "Revisa qué debes hacer para ser el vendedor destacado." },
  precio_alto: { titulo: "Con precio alto", texto: "Ajusta las publicaciones donde tu precio es más caro que el de tu competencia." },
};
const alerta = (clave: keyof typeof TEXTOS, cantidad: number | null, revisadas?: { hechas: number; total: number }) => ({ clave, ...TEXTOS[clave], cantidad, revisadas });

describe("AlertasPublicaciones", () => {
  it("mientras carga muestra la barra", async () => {
    alertasMock.mockImplementation(() => new Promise(() => {}));
    render(<AlertasPublicaciones cuentaMlId="c1" idioma="es-CO" activa={null} />);
    expect(screen.getByText("Revisando alertas de Mercado Libre…")).toBeTruthy();
  });

  it("muestra número, título, texto, «Revisadas X de Y» y enlaces que conservan la cuenta", async () => {
    alertasMock.mockResolvedValue({ ok: true, alertas: [alerta("moderadas", 2), alerta("competencia", 7), alerta("precio_alto", 3, { hechas: 50, total: 120 })], ids: {} });
    render(<AlertasPublicaciones cuentaMlId="c1" idioma="es-CO" activa="precio_alto" />);
    await act(async () => {});
    expect(screen.getByText("Inactivas por incumplir políticas")).toBeTruthy();
    expect(screen.getByText("Revisa qué debes hacer para ser el vendedor destacado.")).toBeTruthy();
    expect(screen.getByText("Revisadas 50 de 120")).toBeTruthy();
    const enlace = screen.getByText("Con precio alto").closest("a")!;
    expect(enlace.getAttribute("href")).toBe("/panel/optimizacion?cuenta=c1&alerta=precio_alto");
    expect(enlace.getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("Quitar filtro").closest("a")!.getAttribute("href")).toBe("/panel/optimizacion?cuenta=c1");
    expect(alertasMock).toHaveBeenCalledWith({ cuentaMlId: "c1" });
  });

  it("una lectura fallida dice «—» y las demás siguen", async () => {
    alertasMock.mockResolvedValue({ ok: true, alertas: [alerta("moderadas", null), alerta("competencia", 7), alerta("precio_alto", 0)], ids: {} });
    render(<AlertasPublicaciones cuentaMlId="c1" idioma="es-CO" activa={null} />);
    await act(async () => {});
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.queryByText("Quitar filtro")).toBeNull();
  });

  it("si la acción falla muestra el aviso", async () => {
    alertasMock.mockResolvedValue({ ok: false, aviso: "Mercado Libre no respondió." });
    render(<AlertasPublicaciones cuentaMlId="c1" idioma="es-CO" activa={null} />);
    await act(async () => {});
    expect(screen.getByText("Mercado Libre no respondió.")).toBeTruthy();
  });

  it("las flechas aparecen solo si no caben y desplazan la fila", async () => {
    alertasMock.mockResolvedValue({ ok: true, alertas: [alerta("moderadas", 1), alerta("competencia", 1), alerta("precio_alto", 1)], ids: {} });
    const scrollBy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", { configurable: true, get: () => 1000 });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 300 });
    HTMLElement.prototype.scrollBy = scrollBy;
    render(<AlertasPublicaciones cuentaMlId="c1" idioma="es-CO" activa={null} />);
    await act(async () => {});
    fireEvent.click(screen.getByLabelText("Ver más alertas"));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: expect.any(Number), behavior: "smooth" }));
    expect(screen.getByLabelText("Ver alertas anteriores")).toBeTruthy();
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
  });
});
