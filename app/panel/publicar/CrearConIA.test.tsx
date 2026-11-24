// @vitest-environment jsdom
//
// «Crear con IA» en un solo recuadro (aprobado por Mateo, 23-nov): el
// orden es 1. Ficha, 2. Imágenes, 3. Títulos y 4. Descripción. Las
// imágenes (GenerarConIA) llegan por la prop pasoImagenes y van justo
// después de la ficha.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("./ia/actions", () => ({
  analizarProductoAction: vi.fn(),
  escribirDescripcionAction: vi.fn(),
  proponerTitulosAction: vi.fn(),
}));

import { CrearConIA } from "./CrearConIA";

afterEach(cleanup);

describe("CrearConIA: un solo recuadro con las imágenes como paso 2", () => {
  const cuentas = [{ id: "c1", nickname: "TIENDA", siteId: "MCO" }] as never[];

  it("muestra «2. Imágenes» con lo que manda el formulario", () => {
    render(
      <CrearConIA cuentas={cuentas} fotos={[]} onUsarTitulo={() => {}} onUsarDescripcion={() => {}} pasoImagenes={<p>generador de imágenes</p>} />
    );
    // El paso 1 se ve antes de analizar, y el 2 justo después.
    const pasos = screen.getAllByText(/^\d\. /).map((e) => e.textContent);
    expect(pasos).toEqual(["1. Ficha del producto", "2. Imágenes"]);
    expect(screen.getByText("generador de imágenes")).toBeTruthy();
    // Títulos y descripción esperan la ficha confirmada.
    expect(screen.queryByText("3. Títulos")).toBeNull();
    expect(screen.queryByText("4. Descripción")).toBeNull();
  });

  it("sin pasoImagenes no deja un paso vacío", () => {
    render(<CrearConIA cuentas={cuentas} fotos={[]} onUsarTitulo={() => {}} onUsarDescripcion={() => {}} />);
    expect(screen.queryByText("2. Imágenes")).toBeNull();
  });
});
