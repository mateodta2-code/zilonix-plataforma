// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const estado = { pending: false };
vi.mock("react-dom", async (orig) => ({ ...(await orig<typeof import("react-dom")>()), useFormStatus: () => ({ pending: estado.pending }) }));

import { FormularioSincronizarFalabella } from "./FormularioSincronizarFalabella";

afterEach(() => {
  cleanup();
  estado.pending = false;
});

describe("FormularioSincronizarFalabella", () => {
  it("en reposo: botón activo y sin banda", () => {
    render(<FormularioSincronizarFalabella accion={vi.fn()} />);
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Trayendo pedidos de Falabella/)).toBeNull();
  });

  it("mientras se envía: banda animada y botón deshabilitado", () => {
    estado.pending = true;
    render(<FormularioSincronizarFalabella accion={vi.fn()} />);
    expect(screen.getByText("Trayendo pedidos de Falabella de los últimos 60 días…")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});
