// @vitest-environment jsdom
//
// «Generación de imágenes para Meli» (antes «Crear con IA», 23-nov):
// imágenes de referencia antes de «Información del producto», y el orden
// 1. Ficha, 2. Títulos, 3. Descripción y 4. Imágenes (al final).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./ia/actions", () => ({
  analizarProductoAction: vi.fn(),
  escribirDescripcionAction: vi.fn(),
  proponerTitulosAction: vi.fn(),
}));

import { BotonesUsarEn, CrearConIA } from "./CrearConIA";

afterEach(cleanup);

describe("CrearConIA: referencias al principio e imágenes al final", () => {
  const cuentas = [{ id: "c1", nickname: "TIENDA", siteId: "MCO" }] as never[];

  it("antes de analizar: referencias, «1. Ficha» y «4. Imágenes» al final", () => {
    const { container } = render(
      <CrearConIA
        cuentas={cuentas}
        fotos={[]}
        onUsarTitulo={() => {}}
        onUsarDescripcion={() => {}}
        referencias={<p>subir referencias</p>}
        pasoImagenes={<p>generador de imágenes</p>}
      />
    );
    const pasos = screen.getAllByText(/^\d\. /).map((e) => e.textContent);
    expect(pasos).toEqual(["1. Ficha del producto", "4. Imágenes"]);
    // Las referencias van antes de «Información del producto».
    const texto = container.textContent ?? "";
    expect(texto.indexOf("Imágenes de referencia")).toBeLessThan(texto.indexOf("Información del producto"));
    expect(texto.indexOf("subir referencias")).toBeLessThan(texto.indexOf("Información del producto"));
    // Títulos y descripción esperan la ficha confirmada.
    expect(screen.queryByText("2. Títulos")).toBeNull();
    expect(screen.queryByText("3. Descripción")).toBeNull();
  });

  it("sin pasoImagenes ni referencias no deja pasos vacíos", () => {
    render(<CrearConIA cuentas={cuentas} fotos={[]} onUsarTitulo={() => {}} onUsarDescripcion={() => {}} />);
    expect(screen.queryByText("4. Imágenes")).toBeNull();
    expect(screen.queryByText("Imágenes de referencia (1 o 2)")).toBeNull();
  });
});

describe("BotonesUsarEn: elegir la cuenta del título o la descripción", () => {
  const dos = [
    { id: "c1", nickname: "TIENDA_UNO", siteId: "MCO" },
    { id: "c2", nickname: "TIENDA_DOS", siteId: "MCO" },
  ] as never[];

  it("un botón por cuenta y «Usar en todas»", async () => {
    const { fireEvent } = await import("@testing-library/react");
    const onUsar = vi.fn();
    render(<BotonesUsarEn cuentas={dos} que="título" onUsar={onUsar} />);
    fireEvent.click(screen.getByText("Usar en TIENDA_DOS"));
    expect(onUsar).toHaveBeenLastCalledWith(["c2"]);
    fireEvent.click(screen.getByText("Usar en todas"));
    expect(onUsar).toHaveBeenLastCalledWith(["c1", "c2"]);
  });

  it("con una sola cuenta no muestra «Usar en todas»", () => {
    render(<BotonesUsarEn cuentas={[dos[0]]} que="título" onUsar={() => {}} />);
    expect(screen.getByText("Usar en TIENDA_UNO")).toBeTruthy();
    expect(screen.queryByText("Usar en todas")).toBeNull();
  });
});
