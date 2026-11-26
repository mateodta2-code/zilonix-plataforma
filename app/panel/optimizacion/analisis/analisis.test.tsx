// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { atribuir } from "@/lib/optimizacion/atribucion";
import type { CambioPublicacion } from "@/lib/optimizacion/analisisDatos";
import { AtribucionIngresos } from "./AtribucionIngresos";
import { CascadaIngresos } from "./CascadaIngresos";
import { TablaCambiosPublicacion } from "./TablaCambiosPublicacion";

const visitasMock = vi.fn();
vi.mock("./actions", () => ({
  PUBLICACIONES_POR_TANDA: 3,
  visitasPublicacionesAnalisisAction: (...a: unknown[]) => visitasMock(...a),
}));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

afterEach(() => {
  cleanup();
  visitasMock.mockReset();
});

const a = atribuir({ visitas: 1000, ventas: 50, ingresos: "1000000.00" }, { visitas: 1200, ventas: 48, ingresos: "1200000.00" })!;

describe("AtribucionIngresos", () => {
  it("dice subieron con el monto, el porcentaje y el factor principal", () => {
    render(<AtribucionIngresos atribucion={a} muestraSuficiente visitasDisponibles canceladas={2} siteId="MCO" idioma="es-CO" verMontos />);
    expect(screen.getByText(/Tus ingresos subieron .*\(\+20 %\), principalmente por conversión|Tus ingresos subieron .*\(\+20 %\), principalmente por/)).toBeTruthy();
    expect(screen.getByText(/Se excluyeron 2 ventas canceladas/)).toBeTruthy();
    expect(screen.getByText("Visitas")).toBeTruthy();
    expect(screen.getByText("Ticket")).toBeTruthy();
  });
  it("sin ventas/consultar no muestra montos", () => {
    const { container } = render(<AtribucionIngresos atribucion={a} muestraSuficiente visitasDisponibles canceladas={0} siteId="MCO" idioma="es-CO" verMontos={false} />);
    expect(container.textContent).not.toMatch(/\$/);
    expect(container.textContent).toMatch(/\(\+20 %\)/);
  });
  it("sin muestra dice «Pocas ventas para concluir» y no reparte", () => {
    render(<AtribucionIngresos atribucion={null} muestraSuficiente={false} visitasDisponibles canceladas={0} siteId="MCO" idioma="es-CO" verMontos />);
    expect(screen.getByText(/Pocas ventas para concluir/)).toBeTruthy();
  });
});

describe("CascadaIngresos", () => {
  it("tiene role img con la frase completa y una tabla con los mismos números", () => {
    render(<CascadaIngresos atribucion={a} siteId="MCO" />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("aria-label")).toMatch(/Ingresos anteriores.*Visitas.*Conversión.*Ticket.*Ingresos actuales/);
    expect(screen.getAllByRole("row")).toHaveLength(6);
  });
});

const fila = (itemId: string, ant: [number, string], act: [number, string], cambio: string): CambioPublicacion => ({
  itemId, titulo: `P ${itemId}`, foto: null, anterior: { ventas: ant[0], ingresos: ant[1] }, actual: { ventas: act[0], ingresos: act[1] }, cambio,
});

describe("TablaCambiosPublicacion", () => {
  const props = { cuentaMlId: "c1", siteId: "MCO", idioma: "es-CO", verMontos: true, periodo: { dias: "30" } };
  it("pide las visitas de a 3, muestra la barra mientras carga y el link al detalle", async () => {
    const caidas = Array.from({ length: 4 }, (_, i) => fila(`MCO${i}`, [10, "1000.00"], [5, "500.00"], "-500.00"));
    const pendientes: Array<(v: unknown) => void> = [];
    visitasMock.mockImplementation(() => new Promise((res) => pendientes.push(res)));
    render(<TablaCambiosPublicacion caidas={caidas} crecimientos={[]} {...props} />);
    expect(screen.getAllByRole("status", { name: "Cargando" }).length).toBeGreaterThan(0);
    expect(screen.getByText("P MCO0").closest("a")?.getAttribute("href")).toBe("/panel/optimizacion/MCO0?cuenta=c1");
    expect(visitasMock.mock.calls[0][1]).toHaveLength(3);
    await act(async () => pendientes[0]({ ok: true, visitas: { MCO0: { actual: 100, anterior: 100 }, MCO1: null, MCO2: { actual: 10, anterior: 10 } } }));
    expect(visitasMock).toHaveBeenCalledTimes(2);
    expect(visitasMock.mock.calls[1][1]).toEqual(["MCO3"]);
  });
  it("sin muestra suficiente: «Pocas ventas para concluir» y sin reparto; fallo: «—»", async () => {
    visitasMock.mockResolvedValue({ ok: true, visitas: { MCO1: { actual: 5, anterior: 5 }, MCO2: null } });
    await act(async () => {
      render(<TablaCambiosPublicacion caidas={[fila("MCO1", [1, "100.00"], [0, "0.00"], "-100.00"), fila("MCO2", [10, "1000.00"], [5, "500.00"], "-500.00")]} crecimientos={[]} {...props} />);
    });
    expect(screen.getByText("Pocas ventas para concluir")).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4);
  });
});
