// @vitest-environment jsdom
//
// «Generación de imágenes para Meli» (antes «Crear con IA», 23-nov):
// imágenes de referencia antes de «Información del producto», la ficha
// arriba y, debajo, las sub pestañas Generar imágenes / Títulos /
// Descripción (24-nov), que se guardan 2 horas en la pestaña.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CAMPOS_FICHA } from "@/lib/publicaciones/ficha";

vi.mock("./ia/actions", () => ({
  analizarProductoAction: vi.fn(),
  escribirDescripcionAction: vi.fn(),
  proponerTitulosAction: vi.fn(),
}));

import { BotonesUsarEn, CrearConIA } from "./CrearConIA";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

describe("CrearConIA: ficha arriba y sub pestañas debajo", () => {
  const cuentas = [{ id: "c1", nickname: "TIENDA", siteId: "MCO" }] as never[];
  const base = { cuentas, fotos: [], onUsarTitulo: () => {}, onUsarDescripcion: () => {} };

  it("referencias antes de «Información del producto» y las 3 sub pestañas, con «Generar imágenes» abierta", () => {
    const { container } = render(<CrearConIA {...base} referencias={<p>subir referencias</p>} pasoImagenes={<p>generador de imágenes</p>} />);
    expect(screen.getAllByText(/^\d\. /).map((e) => e.textContent)).toEqual(["1. Ficha del producto"]);
    const texto = container.textContent ?? "";
    expect(texto.indexOf("Imágenes de referencia")).toBeLessThan(texto.indexOf("Información del producto"));
    expect(texto.indexOf("subir referencias")).toBeLessThan(texto.indexOf("Información del producto"));
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Generar imágenes", "Títulos", "Descripción"]);
    expect(screen.getByRole("tab", { name: "Generar imágenes" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("generador de imágenes")).toBeTruthy();
  });

  it("cambiar de sub pestaña solo oculta la otra: lo de «Generar imágenes» sigue montado", () => {
    render(<CrearConIA {...base} pasoImagenes={<p>generador de imágenes</p>} />);
    fireEvent.click(screen.getByRole("tab", { name: "Títulos" }));
    expect(screen.getByRole("tab", { name: "Títulos" }).getAttribute("aria-selected")).toBe("true");
    const panelImagenes = screen.getByText("generador de imágenes").closest('[role="tabpanel"]') as HTMLElement;
    expect(panelImagenes.hidden).toBe(true);
    // Sin ficha confirmada, Títulos y Descripción lo avisan.
    const panelTitulos = document.getElementById("panel-ia-titulos") as HTMLElement;
    expect(panelTitulos.hidden).toBe(false);
    expect(panelTitulos.textContent).toMatch(/Confirmar ficha/);
  });

  it("sin pasoImagenes no hay sub pestaña de imágenes ni referencias vacías", () => {
    render(<CrearConIA {...base} />);
    expect(screen.queryByRole("tab", { name: "Generar imágenes" })).toBeNull();
    expect(screen.queryByText("Imágenes de referencia (1 o 2)")).toBeNull();
  });

  it("restaura lo guardado (ficha confirmada, sub pestaña) y avisa la ficha a «Generar imágenes»", async () => {
    const ficha = Object.fromEntries(CAMPOS_FICHA.map((c) => [c.clave, { valor: c.clave === "nombre" ? "Bebedero" : null, origen: "vendedor" }]));
    sessionStorage.setItem(
      "zilonix:publicar:ia:textos",
      JSON.stringify({
        ts: Date.now(),
        datos: { cuentaId: "c1", info: "bebedero para gatos", garantia: "", ficha, confirmada: true, categoria: { id: "MCO1", nombre: "Bebederos" }, leyoFotos: true, titulos: null, linkCompetencia: "", tituloCompetencia: "", descripciones: { c1: "Texto guardado" }, pestana: "descripcion" },
      })
    );
    const onFicha = vi.fn();
    render(<CrearConIA {...base} onFicha={onFicha} pasoImagenes={<p>generador</p>} />);
    await waitFor(() => expect(screen.getByRole("tab", { name: "Descripción" }).getAttribute("aria-selected")).toBe("true"));
    expect((screen.getByLabelText("Descripción propuesta para TIENDA") as HTMLTextAreaElement).value).toBe("Texto guardado");
    expect((screen.getByPlaceholderText(/Qué es, marca y modelo/) as HTMLTextAreaElement).value).toBe("bebedero para gatos");
    expect(onFicha).toHaveBeenCalledWith({ ficha, categoriaId: "MCO1" });
    // Confirmada: la ficha queda plegada, con la opción de desplegarla.
    const plegable = screen.getAllByText("Ficha confirmada ✓")[0].closest("details") as HTMLDetailsElement;
    expect(plegable.open).toBe(false);
    expect(plegable.textContent).toContain("Bebedero");
    expect(plegable.textContent).toContain("ver o editar");
  });

  it("con 2 cuentas pide 2 descripciones distintas (versión 1 y 2) y cada una se usa en su cuenta", async () => {
    const { escribirDescripcionAction } = await import("./ia/actions");
    const pedir = vi.mocked(escribirDescripcionAction);
    pedir.mockImplementation(async (e) => ({ ok: true, descripcion: `Texto para ${e.cuentaMlId}` }));
    const dos = [
      { id: "c1", nickname: "UNO", siteId: "MCO" },
      { id: "c2", nickname: "DOS", siteId: "MEC" },
    ] as never[];
    const ficha = Object.fromEntries(CAMPOS_FICHA.map((c) => [c.clave, { valor: c.clave === "nombre" ? "Bebedero" : null, origen: "vendedor" }]));
    sessionStorage.setItem(
      "zilonix:publicar:ia:textos",
      JSON.stringify({ ts: Date.now(), datos: { cuentaId: "c1", info: "", garantia: "", ficha, confirmada: true, categoria: null, leyoFotos: true, titulos: null, linkCompetencia: "", tituloCompetencia: "", descripciones: {}, pestana: "descripcion" } })
    );
    const onUsarDescripcion = vi.fn();
    render(<CrearConIA cuentas={dos} fotos={[]} onUsarTitulo={() => {}} onUsarDescripcion={onUsarDescripcion} />);
    fireEvent.click(await screen.findByText("Proponer 2 descripciones (una por cuenta)"));
    await screen.findByLabelText("Descripción propuesta para DOS");
    expect(pedir.mock.calls.map((c) => [c[0].cuentaMlId, c[0].variante])).toEqual([
      ["c1", { numero: 1, total: 2 }],
      ["c2", { numero: 2, total: 2 }],
    ]);
    fireEvent.click(screen.getByText("Usar cada una en su cuenta"));
    expect(onUsarDescripcion).toHaveBeenCalledWith("c1", "Texto para c1");
    expect(onUsarDescripcion).toHaveBeenCalledWith("c2", "Texto para c2");
  });
});

describe("BotonesUsarEn: elegir la cuenta del título o la descripción", () => {
  const dos = [
    { id: "c1", nickname: "TIENDA_UNO", siteId: "MCO" },
    { id: "c2", nickname: "TIENDA_DOS", siteId: "MCO" },
  ] as never[];

  it("un botón por cuenta y «Usar en todas»", async () => {
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
