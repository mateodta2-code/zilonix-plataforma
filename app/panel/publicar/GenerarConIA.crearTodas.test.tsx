// @vitest-environment jsdom
//
// Barra-A — la barra azul de «Crear todas»: «N de M» con avance real
// (listas + con error sobre el total del lote) y «Imágenes listas» al final.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { GenerarConIA } from "./GenerarConIA";
import type { Ficha } from "@/lib/publicaciones/ficha";

const { preparar, crear } = vi.hoisted(() => ({ preparar: vi.fn(), crear: vi.fn() }));
vi.mock("./ia/imagenes/actions", () => ({
  prepararImagenesAction: preparar,
  crearImagenAction: crear,
  ajustarImagenAction: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const imagen = (id: string) => ({ id, tipo: "portada", nombre: id, cuentaMlId: null, propuesta: {}, prompt: "", prohibidas: [] });

describe("GenerarConIA — barra de «Crear todas» (Barra-A)", () => {
  it("muestra «N de M» mientras se crean y «Imágenes listas» al terminar", async () => {
    preparar.mockResolvedValue({ ok: true, imagenes: [imagen("a"), imagen("b"), imagen("c")], omitidas: [] });
    const resolvers: Record<string, (v: unknown) => void> = {};
    crear.mockImplementation(({ imagenId }: { imagenId: string }) => new Promise((res) => (resolvers[imagenId] = res)));

    render(
      <GenerarConIA
        cuentas={[{ id: "c1", nickname: "Uno", siteId: "MCO", moneda: "COP", idioma: "es-CO" }]}
        ficha={{} as Ficha}
        categoriaId={null}
        fotos={["https://x/1.jpg"]}
        espacioLibre={10}
        galeria={[]}
        portadas={{}}
        onAgregarAGaleria={() => true}
        onUsarPortada={() => {}}
        onReemplazar={() => {}}
      />
    );
    fireEvent.click(screen.getByText("Preparar propuestas (sin costo)"));
    await screen.findByText("Crear todas las aprobadas");
    expect(screen.queryByText("Creando imágenes…")).toBeNull();

    fireEvent.click(screen.getByText("Crear todas las aprobadas"));
    await screen.findByText("Creando imágenes…");
    expect(screen.getByText(/0 de 3 imágenes/)).toBeTruthy();

    // De a 2 a la vez: a y b arrancan; una lista y la otra con error cuentan igual.
    await waitFor(() => expect(resolvers.a && resolvers.b).toBeTruthy());
    await act(async () => resolvers.a({ ok: true, estado: "lista", url: "https://x/a.png", validada: true, avisos: [] }));
    await waitFor(() => expect(screen.getByText(/1 de 3 imágenes/)).toBeTruthy());
    await act(async () => resolvers.b({ ok: false, aviso: "falló" }));
    await waitFor(() => expect(screen.getByText(/2 de 3 imágenes/)).toBeTruthy());

    await waitFor(() => expect(resolvers.c).toBeTruthy());
    await act(async () => resolvers.c({ ok: true, estado: "lista", url: "https://x/c.png", validada: true, avisos: [] }));
    await waitFor(() => expect(screen.getByText("Imágenes listas")).toBeTruthy());
  });
});
