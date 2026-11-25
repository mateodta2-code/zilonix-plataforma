// @vitest-environment jsdom
// Opt-Titulo (Refs #680): título actual, «Mejorar título» con la IA,
// «Copiar» con ventas y «Usar este título» sin ventas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mejorarMock = vi.fn();
const tituloMock = vi.fn();
vi.mock("../actions", () => ({
  editarPrecioAction: vi.fn(),
  editarFotosAction: vi.fn(),
  editarTituloAction: (...a: unknown[]) => tituloMock(...a),
  mejorarTituloIAAction: (...a: unknown[]) => mejorarMock(...a),
  generarImagenIAAction: vi.fn(),
  proponerContenidoIAAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../../publicar/GaleriaFotos", () => ({ GaleriaFotos: () => null }));

import { EditarPublicacion, type DatosEdicion } from "./EditarPublicacion";

const DATOS: DatosEdicion = {
  itemId: "MCO1",
  cuentaMlId: "cuenta-1",
  siteId: "MCO",
  idioma: "es",
  precio: 1000,
  titulo: "Crema Hidratante 50 g",
  vendidas: 0,
  tieneVariantes: false,
  automatizada: false,
  userProduct: false,
  promocion: null,
  fotos: [],
  cloudinaryConfigurado: false,
  iaImagen: { conectada: false } as unknown as DatosEdicion["iaImagen"],
  base: { fijoPorUnidad: null, comision: null, ventas: null, precioParaGanar: null },
};

const SUGERENCIAS = { ok: true, titulos: ["Crema Facial Hidratante 50 g", "Crema Piel Seca 50 g"], catalogo: null, largoMaximo: 60, largoMaximoCatalogo: 120, vendidas: 0 };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EditarPublicacion · Mejorar título", () => {
  beforeEach(() => {
    mejorarMock.mockResolvedValue({ ...SUGERENCIAS, puedeGuardar: true });
  });

  it("muestra siempre el título actual y su largo", () => {
    render(<EditarPublicacion datos={{ ...DATOS, vendidas: 4 }} />);
    expect(screen.getByText("Crema Hidratante 50 g")).toBeTruthy();
    expect(screen.getByText("21/60 caracteres")).toBeTruthy();
    expect(screen.getByText(/esta lleva 4\)\. Copia la sugerencia/)).toBeTruthy();
    expect(screen.queryByText("Guardar título")).toBeNull();
  });

  it("muestra la barra azul mientras genera", async () => {
    let resolver: (v: unknown) => void = () => {};
    mejorarMock.mockReturnValue(new Promise((r) => (resolver = r)));
    render(<EditarPublicacion datos={DATOS} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    expect(await screen.findByText("Generando títulos con IA…")).toBeTruthy();
    resolver({ ...SUGERENCIAS, puedeGuardar: true });
    await waitFor(() => expect(screen.queryByText("Generando títulos con IA…")).toBeNull());
    expect(screen.getByText("Crema Facial Hidratante 50 g")).toBeTruthy();
    expect(mejorarMock).toHaveBeenCalledWith({ cuentaMlId: "cuenta-1", itemId: "MCO1" });
  });

  it("con ventas: «Copiar» pone la sugerencia en el portapapeles y no hay forma de guardar", async () => {
    mejorarMock.mockResolvedValue({ ...SUGERENCIAS, puedeGuardar: false, vendidas: 4 });
    const escribir = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: escribir } });
    render(<EditarPublicacion datos={{ ...DATOS, vendidas: 4 }} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    const copiar = await screen.findAllByText("Copiar");
    expect(screen.getByText("28/60 caracteres")).toBeTruthy();
    fireEvent.click(copiar[0]);
    await waitFor(() => expect(screen.getByText("Copiado")).toBeTruthy());
    expect(escribir).toHaveBeenCalledWith("Crema Facial Hidratante 50 g");
    expect(screen.queryByText("Usar este título")).toBeNull();
    expect(screen.queryByText("Guardar título")).toBeNull();
  });

  it("sin ventas: «Usar este título» lo pasa al campo y guardar pide confirmación", async () => {
    tituloMock.mockResolvedValue({ ok: true, aviso: "Título actualizado en Mercado Libre." });
    const confirmar = vi.spyOn(window, "confirm");
    render(<EditarPublicacion datos={DATOS} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    fireEvent.click((await screen.findAllByText("Usar este título"))[1]);
    const campo = screen.getByLabelText("Título nuevo") as HTMLInputElement;
    expect(campo.value).toBe("Crema Piel Seca 50 g");

    confirmar.mockReturnValueOnce(false);
    fireEvent.click(screen.getByText("Guardar título"));
    expect(confirmar).toHaveBeenCalledWith("¿Cambiar el título en Mercado Libre por: Crema Piel Seca 50 g?");
    expect(tituloMock).not.toHaveBeenCalled();

    confirmar.mockReturnValueOnce(true);
    fireEvent.click(screen.getByText("Guardar título"));
    await waitFor(() => expect(tituloMock).toHaveBeenCalledWith({ cuentaMlId: "cuenta-1", itemId: "MCO1", titulo: "Crema Piel Seca 50 g" }));
  });

  it("sin IA conectada: el aviso con enlace a Conectar IA", async () => {
    mejorarMock.mockResolvedValue({ ok: false, aviso: "Conecta una IA en Administración → Conectar IA.", conectarIA: true });
    render(<EditarPublicacion datos={DATOS} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    const enlace = await screen.findByText("Ir a Conectar IA");
    expect(enlace.getAttribute("href")).toBe("/panel/conectar-ia");
  });
});
