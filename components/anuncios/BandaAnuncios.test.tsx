// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BandaAnuncios } from "./BandaAnuncios";

const anuncios = [
  { id: "a1", mensaje: "Mercado Libre tiene fallas", tipo: "advertencia" as const },
  { id: "a2", mensaje: "Mantenimiento esta noche", tipo: "info" as const },
];

describe("BandaAnuncios", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("muestra los vigentes con su tipo", () => {
    render(<BandaAnuncios anuncios={anuncios} />);
    expect(screen.getByText("Mercado Libre tiene fallas")).toBeTruthy();
    expect(screen.getByText("Advertencia:")).toBeTruthy();
    expect(screen.getByText("Mantenimiento esta noche")).toBeTruthy();
  });

  it("cerrar oculta solo ese y se recuerda en este navegador", () => {
    render(<BandaAnuncios anuncios={anuncios} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Cerrar anuncio" })[0]);
    expect(screen.queryByText("Mercado Libre tiene fallas")).toBeNull();
    expect(screen.getByText("Mantenimiento esta noche")).toBeTruthy();
    cleanup();
    render(<BandaAnuncios anuncios={anuncios} />);
    expect(screen.queryByText("Mercado Libre tiene fallas")).toBeNull();
  });

  it("sin anuncios no pinta nada; un almacenamiento dañado no rompe", () => {
    localStorage.setItem("zx-anuncios-cerrados", "{no es json");
    const { container } = render(<BandaAnuncios anuncios={[]} />);
    expect(container.innerHTML).toBe("");
    render(<BandaAnuncios anuncios={anuncios} />);
    expect(screen.getByText("Mantenimiento esta noche")).toBeTruthy();
  });
});
