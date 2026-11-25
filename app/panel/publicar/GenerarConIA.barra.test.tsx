// @vitest-environment jsdom
//
// «Imágenes creadas» (24-nov): nada entra solo a la galería, cada portada
// se asigna a una cuenta (nunca a la galería) y cada estilo guarda sus
// propias tarjetas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("./ia/imagenes/actions", () => ({ ajustarImagenAction: vi.fn(), crearImagenAction: vi.fn(), prepararImagenesAction: vi.fn() }));

import { GenerarConIA } from "./GenerarConIA";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

const cuentas = [
  { id: "c1", nickname: "TIENDA_UNO", siteId: "MCO" },
  { id: "c2", nickname: "TIENDA_DOS", siteId: "MCO" },
] as never[];

const tarjeta = (id: string, tipo: string) => ({ id, tipo, nombre: id, prompt: "", propuesta: {}, estado: "propuesta", titulo: "T", copy: "", ajuste: "" });

function guardar(datos: Record<string, unknown>) {
  sessionStorage.setItem(
    "zilonix:publicar:ia:imagenes",
    JSON.stringify({
      ts: Date.now(),
      datos: {
        estilo: "zilonix_portadas",
        tiposContenido: [],
        tiposExperto: [],
        opiniones: "",
        fotoBlanco: false,
        cantidadPortadas: 2,
        porEstilo: { zilonix_portadas: [], zilonix_contenido: [], experto_ml: [] },
        omitidasPorEstilo: {},
        creadas: [],
        asignadas: {},
        ...datos,
      },
    })
  );
}

function renderizar(extra: Partial<Parameters<typeof GenerarConIA>[0]> = {}) {
  const props = {
    cuentas,
    ficha: { nombre: { valor: "Bebedero", origen: "vendedor" } } as never,
    categoriaId: null,
    fotos: ["https://res.cloudinary.com/x/ref.jpg"],
    espacioLibre: 10,
    galeria: [] as string[],
    portadas: { c1: "", c2: "" } as Record<string, string>,
    onAgregarAGaleria: vi.fn(() => true),
    onUsarPortada: vi.fn(),
    onReemplazar: vi.fn(),
    ...extra,
  };
  render(<GenerarConIA {...props} />);
  return props;
}

describe("GenerarConIA: «Imágenes creadas»", () => {
  it("cada portada tiene un botón por cuenta, no va a la galería ni se arrastra", async () => {
    guardar({
      creadas: [
        { id: "p1", url: "https://img/p1.png", nombre: "Portada 1", tipo: "portada", estilo: "zilonix_portadas" },
        { id: "p2", url: "https://img/p2.png", nombre: "Portada 2", tipo: "portada", estilo: "zilonix_portadas" },
      ],
    });
    const props = renderizar({ portadas: { c1: "https://img/p1.png", c2: "" } });
    await waitFor(() => expect(screen.getByText("Imágenes creadas (2)")).toBeTruthy());
    expect(screen.queryByText("Agregar a la galería")).toBeNull();
    expect((screen.getByAltText("Imagen creada: Portada 1") as HTMLImageElement).draggable).toBe(false);
    // La Portada 1 ya es de TIENDA_UNO; se elige la Portada 2 para TIENDA_DOS.
    expect(screen.getByLabelText("Usar Portada 1 como portada de TIENDA_UNO").textContent).toBe("✓ Portada de TIENDA_UNO");
    fireEvent.click(screen.getByLabelText("Usar Portada 2 como portada de TIENDA_DOS"));
    expect(props.onUsarPortada).toHaveBeenCalledWith("c2", "https://img/p2.png");
    expect(props.onAgregarAGaleria).not.toHaveBeenCalled();
  });

  it("las demás entran a la galería solo con el botón, y se pueden arrastrar", async () => {
    guardar({
      creadas: [
        { id: "a", url: "https://img/a.png", nombre: "Beneficios", tipo: "beneficios", estilo: "zilonix_contenido" },
        { id: "b", url: "https://img/b.png", nombre: "Medidas", tipo: "medidas", estilo: "experto_ml" },
      ],
    });
    const props = renderizar({ galeria: ["https://img/b.png"] });
    await waitFor(() => expect(screen.getByText("Agregar a la galería")).toBeTruthy());
    expect(props.onAgregarAGaleria).not.toHaveBeenCalled();
    expect(screen.getByText("En la galería")).toBeTruthy();
    expect((screen.getByAltText("Imagen creada: Beneficios") as HTMLImageElement).draggable).toBe(true);
    fireEvent.click(screen.getByText("Agregar a la galería"));
    expect(props.onAgregarAGaleria).toHaveBeenCalledWith("https://img/a.png");
  });

  it("si la galería está llena, lo avisa", async () => {
    guardar({ creadas: [{ id: "a", url: "https://img/a.png", nombre: "Beneficios", tipo: "beneficios", estilo: "zilonix_contenido" }] });
    renderizar({ onAgregarAGaleria: vi.fn(() => false) });
    await waitFor(() => expect(screen.getByText("Agregar a la galería")).toBeTruthy());
    fireEvent.click(screen.getByText("Agregar a la galería"));
    expect(screen.getByRole("alert").textContent).toMatch(/máximo de fotos/);
  });

  it("cambiar de estilo no borra las tarjetas del otro", async () => {
    guardar({ porEstilo: { zilonix_portadas: [tarjeta("p1", "portada")], zilonix_contenido: [tarjeta("k1", "beneficios")], experto_ml: [] } });
    renderizar();
    await waitFor(() => expect(screen.getByText("p1")).toBeTruthy());
    fireEvent.click(screen.getByRole("radio", { name: /Contenido Zilonix/ }));
    expect(screen.getByText("k1")).toBeTruthy();
    expect(screen.queryByText("p1")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /Portadas Zilonix/ }));
    expect(screen.getByText("p1")).toBeTruthy();
  });

  it("la barra sigue visible aunque la ficha se desconfirme", async () => {
    guardar({ creadas: [{ id: "a", url: "https://img/a.png", nombre: "Beneficios", tipo: "beneficios", estilo: "zilonix_contenido" }] });
    renderizar({ ficha: null });
    await waitFor(() => expect(screen.getByText("Imágenes creadas (1)")).toBeTruthy());
  });
});
