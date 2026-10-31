// @vitest-environment jsdom
//
// Issue "zoom de despachos" (fix-despachos-zoom-modal) — mismo patrón
// que PaginaPromociones.test.tsx (@testing-library/react + jsdom):
// nada de DB/acciones de servidor en FotoConZoom.tsx, así que esta
// prueba corre con DOM real sin necesitar Postgres.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { FotoConZoom } from "./FotoConZoom";

afterEach(() => cleanup());

const SRC = "https://http2.mlstatic.com/D_foto-de-prueba.jpg";
const ALT = "Producto de prueba";

function abrir() {
  fireEvent.click(screen.getByRole("button", { name: /ver foto ampliada/i }));
}

describe("FotoConZoom — modal (fix-despachos-zoom-modal)", () => {
  it("sin hover: nada se abre con solo pasar el mouse por la miniatura", () => {
    render(<FotoConZoom src={SRC} alt={ALT} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /ver foto ampliada/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("abre el modal con click en la miniatura, con foco en el botón Cerrar", () => {
    render(<FotoConZoom src={SRC} alt={ALT} />);
    abrir();
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cerrar" }));
    // Bloquea el scroll del fondo mientras está abierto (punto 3).
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("cierra con el botón X y restaura el scroll del fondo", () => {
    render(<FotoConZoom src={SRC} alt={ALT} />);
    abrir();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });

  it("cierra con Esc", () => {
    render(<FotoConZoom src={SRC} alt={ALT} />);
    abrir();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("cierra con click en el fondo, pero NO con click adentro del marco de la foto", () => {
    render(<FotoConZoom src={SRC} alt={ALT} />);
    abrir();
    const dialogo = screen.getByRole("dialog");
    fireEvent.click(dialogo); // adentro del marco — sigue abierto
    expect(screen.queryByRole("dialog")).not.toBeNull();
    fireEvent.click(dialogo.parentElement!); // el fondo oscuro mismo
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // Issue "zoom de despachos" (fix-zoom-tamano) — bug real reportado
  // por Mateo: el modal usaba la MISMA url que la miniatura (chica a
  // propósito en Mercado Libre), nunca una versión grande.
  it("el modal usa srcAmpliada (alta resolución), nunca la miniatura (src)", () => {
    const miniatura = "https://http2.mlstatic.com/D_NQ_NP_1-MCO1-I.jpg";
    const grande = "https://http2.mlstatic.com/D_NQ_NP_1-MCO1-O.jpg";
    render(<FotoConZoom src={miniatura} srcAmpliada={grande} alt={ALT} />);
    abrir();
    const imagenModal = within(screen.getByRole("dialog")).getByRole("img");
    expect(imagenModal.getAttribute("src")).toBe(grande);
    expect(imagenModal.getAttribute("src")).not.toBe(miniatura);
  });

  it("sin srcAmpliada, el modal cae a src en vez de no mostrar nada", () => {
    render(<FotoConZoom src={SRC} alt={ALT} />);
    abrir();
    const imagenModal = within(screen.getByRole("dialog")).getByRole("img");
    expect(imagenModal.getAttribute("src")).toBe(SRC);
  });
});
