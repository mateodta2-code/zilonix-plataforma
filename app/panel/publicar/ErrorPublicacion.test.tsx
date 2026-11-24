// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ErrorPublicacion } from "./ErrorPublicacion";
import { FIXTURE_VALIDACION } from "@/lib/ml/publicar-errores-validacion.fixture";

afterEach(cleanup);

describe("ErrorPublicacion", () => {
  it("muestra el mensaje amigable y no el JSON crudo como mensaje principal", () => {
    const { container } = render(<ErrorPublicacion error={FIXTURE_VALIDACION} />);
    expect(screen.getByText("Lo que bloquea la publicación")).toBeTruthy();
    expect(screen.getByText("Avisos")).toBeTruthy();
    expect(screen.getByText(/código de barras \(GTIN\)/)).toBeTruthy();
    expect(screen.getByText(/Falta el campo ‹Tipo de producto›/)).toBeTruthy();
    // El JSON solo vive dentro del <details>.
    const fuera = Array.from(container.children).flatMap((el) => Array.from(el.querySelectorAll("*"))).filter((el) => !el.closest("details"));
    expect(fuera.some((el) => (el.textContent ?? "").includes("validation_error"))).toBe(false);
    expect(screen.getByText("Ver detalle técnico")).toBeTruthy();
    expect(container.textContent).not.toMatch(/reconect/i);
  });

  it("un texto normal se muestra tal cual", () => {
    render(<ErrorPublicacion error="Faltan las dimensiones del paquete" />);
    expect(screen.getByText("Faltan las dimensiones del paquete")).toBeTruthy();
  });
});
