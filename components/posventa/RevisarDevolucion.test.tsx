// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const revisar = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/panel/preguntas/reclamos/[cuentaId]/[reclamoId]/accionesResolucion", () => ({
  revisarDevolucionAction: revisar,
  leerMotivosFallaDevolucionAction: async () => ({ ok: true, motivos: [] }),
}));

import { RevisarDevolucion } from "./RevisarDevolucion";

afterEach(cleanup);

describe("RevisarDevolucion", () => {
  it("no envía nada con solo abrir el diálogo ni sin escribir la frase", () => {
    render(<RevisarDevolucion cuentaId="c" reclamoId="1" devolucionId="2" motivoNoDisponible={null} />);
    fireEvent.click(screen.getByText("Llegó bien"));
    fireEvent.click(screen.getByText("Continuar"));
    expect(revisar).not.toHaveBeenCalled();
    expect((screen.getByText("Confirmar que llegó bien") as HTMLButtonElement).disabled).toBe(true);
  });

  it("con motivo de no disponible, los botones quedan deshabilitados", () => {
    render(<RevisarDevolucion cuentaId="c" reclamoId="1" devolucionId="2" motivoNoDisponible="No disponible" />);
    expect((screen.getByText("Llegó bien") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("No disponible")).toBeTruthy();
  });
});
