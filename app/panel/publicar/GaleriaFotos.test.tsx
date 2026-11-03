// @vitest-environment jsdom
//
// Review PR #372 (ALTO 1 + MEDIO) — mismo patrón que
// ImpresionMasivaForm.test.tsx (@testing-library/react + jsdom, fetch
// con vi.stubGlobal). Cubre lo que encontró la revisión: el orden de
// selección se preserva aunque la red responda fuera de orden, una
// foto que falla no tira abajo las demás, y el cupo de maxFotos se
// cuenta contra lo ya subido MÁS lo que sigue en vuelo.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { GaleriaFotos } from "./GaleriaFotos";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function crearArchivo(nombre: string): File {
  return new File([new Uint8Array([0xff, 0xd8, 0xff])], nombre, { type: "image/jpeg" });
}

function nombreDelArchivoSubido(init: RequestInit | undefined): string {
  const form = init?.body as FormData;
  return (form.get("archivo") as File).name;
}

function inputArchivo(container: HTMLElement): HTMLInputElement {
  return container.querySelector('input[type="file"]') as HTMLInputElement;
}

describe("GaleriaFotos — subida en lote (ALTO 1, review PR #372)", () => {
  it("preserva el orden de selección aunque la red responda fuera de orden", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const nombre = nombreDelArchivoSubido(init);
        // a.jpg demora más que b.jpg y c.jpg a propósito: si el código
        // ordenara por llegada en vez de por selección, este test fallaría.
        const demora = nombre === "a.jpg" ? 30 : nombre === "b.jpg" ? 5 : 15;
        return new Promise((resolve) =>
          setTimeout(() => resolve({ ok: true, json: async () => ({ url: `https://cdn/${nombre}` }) }), demora)
        );
      })
    );

    const onChange = vi.fn();
    const { container } = render(<GaleriaFotos urls={[]} onChange={onChange} cloudinaryConfigurado limiteFotos={null} />);

    fireEvent.change(inputArchivo(container), {
      target: { files: [crearArchivo("a.jpg"), crearArchivo("b.jpg"), crearArchivo("c.jpg")] },
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["https://cdn/a.jpg", "https://cdn/b.jpg", "https://cdn/c.jpg"]));
    // Un solo llamado — no uno por foto con el `urls` viejo pisándose.
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("si una foto del lote falla, las demás quedan y se avisa en español", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        const nombre = nombreDelArchivoSubido(init);
        if (nombre === "rota.jpg") return Promise.resolve({ ok: false, json: async () => ({ error: "no sirve" }) });
        return Promise.resolve({ ok: true, json: async () => ({ url: `https://cdn/${nombre}` }) });
      })
    );

    const onChange = vi.fn();
    const { container } = render(<GaleriaFotos urls={[]} onChange={onChange} cloudinaryConfigurado limiteFotos={null} />);

    fireEvent.change(inputArchivo(container), {
      target: { files: [crearArchivo("ok1.jpg"), crearArchivo("rota.jpg"), crearArchivo("ok2.jpg")] },
    });

    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith(["https://cdn/ok1.jpg", "https://cdn/ok2.jpg"]));
    expect(await screen.findByText(/no se pudieron subir 1 de 3 fotos/i)).not.toBeNull();
  });

  it("respeta maxFotos aunque se suelten dos tandas antes de que la primera termine", () => {
    const fetchMock = vi.fn(() => new Promise(() => {})); // nunca resuelve — solo interesa cuántas veces se llama
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    const { container } = render(<GaleriaFotos urls={[]} onChange={onChange} cloudinaryConfigurado limiteFotos={3} />);
    const boton = container.querySelector('button[aria-label="Subir foto desde la PC"]') as HTMLElement;

    fireEvent.drop(boton, { dataTransfer: { files: [crearArchivo("1.jpg"), crearArchivo("2.jpg")] } });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.drop(boton, { dataTransfer: { files: [crearArchivo("3.jpg"), crearArchivo("4.jpg")] } });
    expect(fetchMock).toHaveBeenCalledTimes(3); // solo 1 más entró — el cupo de 3 ya estaba completo con las 2 en vuelo
    expect(screen.getByText(/1 foto quedó fuera por el límite/i)).not.toBeNull();
  });

  it("filtra el drop para aceptar solo imágenes", () => {
    const fetchMock = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const onChange = vi.fn();
    const { container } = render(<GaleriaFotos urls={[]} onChange={onChange} cloudinaryConfigurado limiteFotos={null} />);
    const boton = container.querySelector('button[aria-label="Subir foto desde la PC"]') as HTMLElement;

    const pdf = new File(["%PDF"], "catalogo.pdf", { type: "application/pdf" });
    const foto = crearArchivo("foto.jpg");
    fireEvent.drop(boton, { dataTransfer: { files: [pdf, foto] } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(nombreDelArchivoSubido(fetchMock.mock.calls[0][1] as RequestInit)).toBe("foto.jpg");
  });
});
