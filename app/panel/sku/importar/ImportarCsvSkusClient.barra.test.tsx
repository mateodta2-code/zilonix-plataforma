// @vitest-environment jsdom
//
// Barra-D: banda azul mientras se revisa o se importa el CSV de SKU.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./actions", () => ({ previsualizarImportacionAction: vi.fn(), confirmarImportacionAction: vi.fn() }));

import { ImportarCsvSkusClient } from "./ImportarCsvSkusClient";
import { confirmarImportacionAction, previsualizarImportacionAction } from "./actions";

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
  csvTexto: "sku,cantidad_inicial\nA1,1",
  vistaPrevia: {
    filas: [{ sku: "A1", nombre: "Uno", bodega: null, cantidadInicial: 1, yaExiste: false }],
    errores: [],
    resumen: { validas: 1, nuevos: 1, existentes: 0, conError: 0, skusRepetidos: [] },
  },
};

describe("ImportarCsvSkusClient: banda de carga", () => {
  it("«Revisando el archivo…» y luego «Importando SKUs…», y se va al terminar", async () => {
    const prev = diferida();
    const conf = diferida();
    vi.mocked(previsualizarImportacionAction).mockReturnValue(prev.promesa as never);
    vi.mocked(confirmarImportacionAction).mockReturnValue(conf.promesa as never);
    const { container } = render(<ImportarCsvSkusClient />);
    expect(screen.queryByText("Revisando el archivo…")).toBeNull();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.csv", { type: "text/csv" })] } });
    fireEvent.submit(container.querySelector("form") as HTMLFormElement);
    expect((await screen.findByText("Revisando el archivo…")).closest('[role="status"]')).toBeTruthy();
    await act(async () => prev.resolver(revisar));
    await waitFor(() => expect(screen.queryByText("Revisando el archivo…")).toBeNull());

    fireEvent.click(screen.getByText(/Confirmar importación/));
    expect((await screen.findByText("Importando SKUs…")).closest('[role="status"]')).toBeTruthy();
    await act(async () => conf.resolver({ paso: "confirmado", resultado: { creados: 1, actualizados: 0, sinCambios: 0, omitidosPorError: 0 } }));
    await waitFor(() => expect(screen.queryByText("Importando SKUs…")).toBeNull());
    expect(screen.getByText(/SKU creado/)).toBeTruthy();
  });
});
