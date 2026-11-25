// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const acciones = vi.hoisted(() => ({ mejorar: vi.fn(), titulo: vi.fn(), precio: vi.fn(), fotos: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("../actions", () => ({
  mejorarTituloIAAction: acciones.mejorar,
  editarTituloAction: acciones.titulo,
  editarPrecioAction: acciones.precio,
  editarFotosAction: acciones.fotos,
}));
vi.mock("../../publicar/GaleriaFotos", () => ({ GaleriaFotos: () => null }));
vi.mock("./CrearImagenIA", () => ({ CrearImagenIA: () => null }));

import { EditarPublicacion, type DatosEdicion } from "./EditarPublicacion";

afterEach(cleanup);

const datos = (vendidas: number): DatosEdicion =>
  ({
    itemId: "MCO1",
    cuentaMlId: "cuenta",
    siteId: "MCO",
    idioma: "es-CO",
    precio: 1000,
    titulo: "Termo acero azul 1 L",
    vendidas,
    tieneVariantes: false,
    automatizada: false,
    userProduct: false,
    promocion: null,
    fotos: [],
    cloudinaryConfigurado: false,
    iaImagen: { disponible: false } as unknown as DatosEdicion["iaImagen"],
    base: { fijoPorUnidad: null, comision: null, ventas: null, precioParaGanar: null },
  }) as DatosEdicion;

const propuesta = (puedeGuardar: boolean, vendidas: number) => ({
  ok: true,
  titulos: ["Termo de acero azul 1 L", "Termo azul acero inoxidable"],
  catalogo: null,
  largoMaximo: 60,
  largoMaximoCatalogo: 120,
  puedeGuardar,
  vendidas,
});

describe("Título en EditarPublicacion", () => {
  beforeEach(() => {
    Object.values(acciones).forEach((f) => f.mockReset());
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("muestra siempre el título actual con su largo", () => {
    render(<EditarPublicacion datos={datos(4)} />);
    expect(screen.getByText("Termo acero azul 1 L")).toBeTruthy();
    expect(screen.getByText("(20/60 caracteres)")).toBeTruthy();
  });

  it("muestra la barra mientras genera", async () => {
    let resolver: (v: unknown) => void = () => {};
    acciones.mejorar.mockReturnValue(new Promise((r) => (resolver = r)));
    render(<EditarPublicacion datos={datos(0)} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    await waitFor(() => expect(screen.getByText("Generando títulos con IA…")).toBeTruthy());
    resolver(propuesta(true, 0));
    await waitFor(() => expect(screen.getByLabelText("Títulos sugeridos")).toBeTruthy());
  });

  it("con ventas: «Copiar» y la nota, sin «Usar este título»", async () => {
    acciones.mejorar.mockResolvedValue(propuesta(false, 4));
    render(<EditarPublicacion datos={datos(4)} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    const copiar = await screen.findAllByText("Copiar");
    expect(copiar).toHaveLength(2);
    expect(screen.queryByText("Usar este título")).toBeNull();
    expect(screen.queryByText("Guardar título")).toBeNull();
    expect(screen.getByText(/no deja cambiar el título de publicaciones con ventas \(esta lleva 4\)/)).toBeTruthy();
    fireEvent.click(copiar[0]);
    await waitFor(() => expect(screen.getByText("Copiado ✓")).toBeTruthy());
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("Termo de acero azul 1 L");
  });

  it("sin ventas: «Usar este título» lo pasa al campo y guardar pide confirmación", async () => {
    acciones.mejorar.mockResolvedValue(propuesta(true, 0));
    acciones.titulo.mockResolvedValue({ ok: true, aviso: "Listo" });
    const confirmar = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<EditarPublicacion datos={datos(0)} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    const usar = await screen.findAllByText("Usar este título");
    expect(screen.queryByText("Copiar")).toBeNull();
    fireEvent.click(usar[1]);
    expect((screen.getByLabelText("Título nuevo") as HTMLInputElement).value).toBe("Termo azul acero inoxidable");
    fireEvent.click(screen.getByText("Guardar título"));
    expect(confirmar).toHaveBeenCalledWith("¿Cambiar el título en Mercado Libre por: Termo azul acero inoxidable?");
    expect(acciones.titulo).not.toHaveBeenCalled();
    confirmar.mockReturnValue(true);
    fireEvent.click(screen.getByText("Guardar título"));
    await waitFor(() => expect(acciones.titulo).toHaveBeenCalledWith({ cuentaMlId: "cuenta", itemId: "MCO1", titulo: "Termo azul acero inoxidable" }));
  });

  it("sin IA: muestra el aviso con enlace a Conectar IA", async () => {
    acciones.mejorar.mockResolvedValue({ ok: false, aviso: "Conecta una IA", conectarIA: true });
    render(<EditarPublicacion datos={datos(0)} />);
    fireEvent.click(screen.getByText("Mejorar título"));
    expect(await screen.findByText(/Conecta una IA/)).toBeTruthy();
    expect(screen.getByText("Ir a Conectar IA").getAttribute("href")).toBe("/panel/conectar-ia");
  });
});
