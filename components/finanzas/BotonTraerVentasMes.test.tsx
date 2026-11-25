// @vitest-environment jsdom
// Barra-C (Refs #619): banda indeterminada mientras se traen las ventas del mes.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { BotonTraerVentasMes } from "./BotonTraerVentasMes";

// React 18 (vitest) no mantiene isPending durante un callback async como lo hace Next en la app;
// se simula `pendiente` a mano para probar solo la banda.
const sim = vi.hoisted(() => ({ pendiente: false }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useTransition: () => [sim.pendiente, (fn: () => void) => void fn()],
}));

vi.mock("@/app/panel/finanzas/ventas/actions", () => ({
  traerVentasDelMesAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

describe("BotonTraerVentasMes · BarraCarga", () => {
  it("muestra la banda mientras está pendiente y la quita al terminar", () => {
    sim.pendiente = false;
    const { rerender } = render(<BotonTraerVentasMes cuentaId={null} />);
    expect(screen.queryByText("Trayendo ventas del mes de Mercado Libre…")).toBeNull();
    sim.pendiente = true;
    rerender(<BotonTraerVentasMes cuentaId={null} />);
    expect(screen.getByText("Trayendo ventas del mes de Mercado Libre…")).toBeTruthy();
    expect(screen.getByText("Trayendo ventas…")).toBeTruthy();
    sim.pendiente = false;
    rerender(<BotonTraerVentasMes cuentaId={null} />);
    expect(screen.queryByText("Trayendo ventas del mes de Mercado Libre…")).toBeNull();
  });
});
