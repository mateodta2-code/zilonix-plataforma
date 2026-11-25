// @vitest-environment jsdom
//
// Issue "pendientes no muestra venta nueva" — mismo patrón que
// CopiarTexto.test.tsx (@testing-library/react + jsdom). sincronizarAhoraAction
// se mockea entero (su propia prueba ya vive en actions.test.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const sincronizarAhoraActionMock = vi.fn();
vi.mock("./actions", () => ({ sincronizarAhoraAction: () => sincronizarAhoraActionMock() }));

import { SincronizarAhoraCliente } from "./SincronizarAhoraCliente";

afterEach(() => {
  cleanup();
  sincronizarAhoraActionMock.mockReset();
  refresh.mockReset();
});

describe("SincronizarAhoraCliente", () => {
  it("al hacer click, muestra el resumen y refresca la página", async () => {
    sincronizarAhoraActionMock.mockResolvedValue({ ok: true, resumen: "STOREKINGSAS: 5 de 5 ventas guardadas." });
    render(<SincronizarAhoraCliente />);
    fireEvent.click(screen.getByText("Sincronizar ahora"));
    expect(await screen.findByText("STOREKINGSAS: 5 de 5 ventas guardadas.")).not.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("si falla, muestra el error y NO refresca la página", async () => {
    sincronizarAhoraActionMock.mockResolvedValue({ ok: false, error: "No hay cuentas de Mercado Libre conectadas para sincronizar." });
    render(<SincronizarAhoraCliente />);
    fireEvent.click(screen.getByText("Sincronizar ahora"));
    expect(await screen.findByText("No hay cuentas de Mercado Libre conectadas para sincronizar.")).not.toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("mientras corre: banda animada (sin progressbar) y botón deshabilitado; al terminar, completa con el resumen", async () => {
    let resolver!: (v: unknown) => void;
    sincronizarAhoraActionMock.mockReturnValue(new Promise((r) => (resolver = r)));
    render(<SincronizarAhoraCliente />);
    fireEvent.click(screen.getByText("Sincronizar ahora"));
    expect(await screen.findByText("Sincronizando ventas de Mercado Libre…")).not.toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect((screen.getByRole("button", { name: "Sincronizando…" }) as HTMLButtonElement).disabled).toBe(true);
    resolver({ ok: true, resumen: "CUENTA: 2 de 2 ventas guardadas." });
    expect(await screen.findByText("CUENTA: 2 de 2 ventas guardadas.")).not.toBeNull();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  });
});
