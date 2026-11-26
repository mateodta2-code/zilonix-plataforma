// @vitest-environment jsdom
//
// Barra-D: banda azul mientras «Actualizar ahora» corre; el aviso final sigue igual.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// React 18 de pruebas no mantiene «pendiente» una transición asíncrona (Next
// sí, con su React canary): se simula con estado para ver la banda.
vi.mock("react", async (importar) => {
  const real = await importar<typeof import("react")>();
  return {
    ...real,
    useTransition: () => {
      const [pendiente, setPendiente] = real.useState(false);
      return [pendiente, (f: () => Promise<void>) => { setPendiente(true); void f().finally(() => setPendiente(false)); }] as const;
    },
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("./actions", () => ({ actualizarPublicidadAction: vi.fn() }));

import { FormActualizar } from "./FormActualizar";
import { actualizarPublicidadAction } from "./actions";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const TITULO = "Actualizando publicidad de Mercado Libre… Puede tardar unos minutos. No cierres esta página.";

describe("FormActualizar: banda de carga", () => {
  it("aparece mientras actualiza y se va al terminar, con el aviso final", async () => {
    let resolver!: (v: unknown) => void;
    vi.mocked(actualizarPublicidadAction).mockReturnValue(new Promise((r) => (resolver = r)) as never);
    render(<FormActualizar cuentaMlId="c1" />);
    expect(screen.queryByText(TITULO)).toBeNull();
    fireEvent.submit(screen.getByText("Actualizar ahora").closest("form") as HTMLFormElement);
    const banda = await screen.findByText(TITULO);
    expect(banda.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByText("Actualizando…")).toBeTruthy();
    await act(async () => resolver({ ok: true, incompleta: false, aviso: "Listo" }));
    await waitFor(() => expect(screen.queryByText(TITULO)).toBeNull());
    expect(screen.getByText("Listo")).toBeTruthy();
  });
});
