// @vitest-environment jsdom
//
// Barra-D: banda azul de carga mientras la IA analiza o propone (sin llamadas extra).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CAMPOS_FICHA } from "@/lib/publicaciones/ficha";

vi.mock("./ia/actions", () => ({
  analizarProductoAction: vi.fn(),
  escribirDescripcionAction: vi.fn(),
  proponerTitulosAction: vi.fn(),
}));

import { CrearConIA } from "./CrearConIA";
import { analizarProductoAction, escribirDescripcionAction, proponerTitulosAction } from "./ia/actions";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.clearAllMocks();
});

const cuentas = [{ id: "c1", nickname: "TIENDA", siteId: "MCO" }] as never[];
const base = { cuentas, fotos: [], onUsarTitulo: () => {}, onUsarDescripcion: () => {} };

function diferida<T>() {
  let resolver!: (v: T) => void;
  const promesa = new Promise<T>((r) => (resolver = r));
  return { promesa, resolver };
}

function guardarFichaConfirmada() {
  const ficha = Object.fromEntries(CAMPOS_FICHA.map((c) => [c.clave, { valor: c.clave === "nombre" ? "Bebedero" : null, origen: "vendedor" }]));
  sessionStorage.setItem(
    "zilonix:publicar:ia:textos",
    JSON.stringify({
      ts: Date.now(),
      datos: { cuentaId: "c1", info: "bebedero", garantia: "", ficha, confirmada: true, categoria: { id: "MCO1", nombre: "Bebederos" }, leyoFotos: true, titulos: null, linkCompetencia: "", tituloCompetencia: "", descripcion: "", pestana: "titulos" },
    })
  );
}

describe("CrearConIA: banda de carga", () => {
  it("«Analizando el producto con IA…» aparece mientras analiza y se va al terminar", async () => {
    const d = diferida<unknown>();
    vi.mocked(analizarProductoAction).mockReturnValue(d.promesa as never);
    render(<CrearConIA {...base} />);
    expect(screen.queryByText("Analizando el producto con IA…")).toBeNull();
    fireEvent.click(screen.getByText("Analizar producto"));
    const banda = await screen.findByText("Analizando el producto con IA…");
    expect(banda.closest('[role="status"]')).toBeTruthy();
    await act(async () => d.resolver({ ok: false, aviso: "Sin IA" }));
    await waitFor(() => expect(screen.queryByText("Analizando el producto con IA…")).toBeNull());
    expect(screen.getByText("Sin IA")).toBeTruthy();
  });

  it("«Proponiendo títulos…» mientras propone títulos", async () => {
    guardarFichaConfirmada();
    const d = diferida<unknown>();
    vi.mocked(proponerTitulosAction).mockReturnValue(d.promesa as never);
    render(<CrearConIA {...base} />);
    fireEvent.click(await screen.findByText("Proponer títulos"));
    expect(await screen.findByText("Proponiendo títulos…")).toBeTruthy();
    await act(async () => d.resolver({ ok: false, aviso: "Falló" }));
    await waitFor(() => expect(screen.queryByText("Proponiendo títulos…")).toBeNull());
  });

  it("«Proponiendo descripción…» mientras escribe la descripción", async () => {
    guardarFichaConfirmada();
    const d = diferida<unknown>();
    vi.mocked(escribirDescripcionAction).mockReturnValue(d.promesa as never);
    render(<CrearConIA {...base} />);
    fireEvent.click(await screen.findByText("Proponer descripción"));
    expect(await screen.findByText("Proponiendo descripción…")).toBeTruthy();
    await act(async () => d.resolver({ ok: false, aviso: "Falló" }));
    await waitFor(() => expect(screen.queryByText("Proponiendo descripción…")).toBeNull());
  });
});
