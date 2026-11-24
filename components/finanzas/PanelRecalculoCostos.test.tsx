// @vitest-environment jsdom
// Barra-C (Refs #619): banda indeterminada «Buscando cambios de costo…» mientras `pendiente`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PanelRecalculoCostos } from "./PanelRecalculoCostos";

// React 18 (vitest) no mantiene isPending durante un callback async como lo hace Next en la app;
// se simula `pendiente` a mano para probar solo la banda.
const sim = vi.hoisted(() => ({ pendiente: false }));
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useTransition: () => [sim.pendiente, (fn: () => void) => void fn()],
}));

let resolver: (v: unknown) => void = () => {};
vi.mock("@/app/panel/finanzas/ventas/actions", () => ({
  previsualizarRecalculoAction: () => new Promise((res) => { resolver = res; }),
  confirmarRecalculoAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(cleanup);

describe("PanelRecalculoCostos · BarraCarga", () => {
  it("muestra la banda al buscar y la quita al terminar", async () => {
    sim.pendiente = false;
    const { rerender } = render(<PanelRecalculoCostos />);
    fireEvent.change(screen.getByPlaceholderText("BASE o BASEX2"), { target: { value: "BASE" } });
    await act(async () => fireEvent.click(screen.getByText("Ver cambios")));
    sim.pendiente = true;
    rerender(<PanelRecalculoCostos />);
    expect(screen.getByText("Buscando cambios de costo…")).toBeTruthy();
    expect(screen.getByText("Buscando…")).toBeTruthy();
    await act(async () => resolver({ ok: false, lineas: ["Nada"] }));
    sim.pendiente = false;
    rerender(<PanelRecalculoCostos />);
    expect(screen.queryByText("Buscando cambios de costo…")).toBeNull();
  });
});
