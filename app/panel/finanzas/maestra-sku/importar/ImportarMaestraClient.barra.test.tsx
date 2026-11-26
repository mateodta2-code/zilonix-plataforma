// @vitest-environment jsdom
//
// Barra-D: banda azul mientras se revisa o se guarda la maestra de SKU.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./actions", () => ({ previsualizarMaestraAction: vi.fn(), confirmarMaestraAction: vi.fn() }));

import { ImportarMaestraClient } from "./ImportarMaestraClient";
import { confirmarMaestraAction, previsualizarMaestraAction } from "./actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function diferida() {
  let resolver!: (v: unknown) => void;
  const promesa = new Promise((r) => (resolver = r));
  return { promesa, resolver };
}

const revisar = {
  paso: "revisar",
  vistaPrevia: {
    encabezados: [],
    mapeo: {},
    filas: [{ numeroFila: 2, sku: "A1", estado: "nueva", cambios: [], avisos: [] }],
    errores: [],
    resumen: { nuevas: 1, cambios: 0, sinCambios: 0, conError: 0, conAviso: 0, proveedoresNuevos: 0 },
  },
};

describe("ImportarMaestraClient: banda de carga", () => {
  it("«Revisando el archivo…» y luego «Guardando la maestra…», y se va al terminar", async () => {
    const prev = diferida();
    const conf = diferida();
    vi.mocked(previsualizarMaestraAction).mockReturnValue(prev.promesa as never);
    vi.mocked(confirmarMaestraAction).mockReturnValue(conf.promesa as never);
    const { container } = render(<ImportarMaestraClient />);
    expect(screen.queryByText("Revisando el archivo…")).toBeNull();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "m.csv", { type: "text/csv" })] } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect((await screen.findByText("Revisando el archivo…")).closest('[role="status"]')).toBeTruthy();
    await act(async () => prev.resolver(revisar));
    await waitFor(() => expect(screen.queryByText("Revisando el archivo…")).toBeNull());

    fireEvent.click(screen.getByText(/Confirmar \(1\)/));
    expect((await screen.findByText("Guardando la maestra…")).closest('[role="status"]')).toBeTruthy();
    await act(async () =>
      conf.resolver({ paso: "confirmado", resultado: { nuevas: 1, actualizadas: 0, sinCambios: 0, proveedoresCreados: 0 } })
    );
    await waitFor(() => expect(screen.queryByText("Guardando la maestra…")).toBeNull());
    expect(screen.getByText(/SKU nuevo/)).toBeTruthy();
  });
});
