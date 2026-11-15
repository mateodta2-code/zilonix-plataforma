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
});
