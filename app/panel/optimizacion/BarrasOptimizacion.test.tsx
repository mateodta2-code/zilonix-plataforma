// @vitest-environment jsdom
// Opt-Barra (Refs #677): la barra azul sale mientras carga y se va al terminar.
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

let pendiente = false;
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useTransition: () => [pendiente, (f: () => void) => f()],
}));
const generarMock = vi.fn();
const proponerMock = vi.fn();
const precioMock = vi.fn();
const diagMock = vi.fn();
vi.mock("./actions", () => ({
  generarImagenIAAction: (...a: unknown[]) => generarMock(...a),
  proponerContenidoIAAction: (...a: unknown[]) => proponerMock(...a),
  editarPrecioAction: (...a: unknown[]) => precioMock(...a),
  editarTituloAction: vi.fn(),
  editarFotosAction: vi.fn(),
  diagnosticoPublicacionAction: (...a: unknown[]) => diagMock(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("../publicar/GaleriaFotos", () => ({ GaleriaFotos: () => null }));

import Cargando from "./loading";
import CargandoDetalle from "./[itemId]/loading";
import { CrearImagenIA } from "./[itemId]/CrearImagenIA";
import { DiagnosticoPublicacion } from "./[itemId]/DiagnosticoPublicacion";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Optimización · barras", () => {
  it("loading de lista y detalle muestran la barra", () => {
    render(<Cargando />);
    expect(screen.getByText("Cargando publicaciones…")).toBeTruthy();
    cleanup();
    render(<CargandoDetalle />);
    expect(screen.getByText("Cargando la publicación…")).toBeTruthy();
  });

  it("Crear imagen con IA: avanza «1 de 2», «2 de 2» y termina", async () => {
    const pendientes: Array<(v: unknown) => void> = [];
    generarMock.mockImplementation(() => new Promise((res) => pendientes.push(res)));
    render(<CrearImagenIA cuentaMlId="c" itemId="MCO1" fotos={["a.jpg"]} tituloProducto={null} estado="lista" onAgregar={() => {}} />);
    fireEvent.click(screen.getByRole("radio", { name: "1 portada" }));
    fireEvent.click(screen.getByRole("radio", { name: "10 portadas" }));
    fireEvent.click(screen.getByRole("radio", { name: "4 portadas" }));
    fireEvent.click(screen.getByText("Crear 4 portadas"));
    expect(await screen.findByText("Creando imagen 1 de 4…")).toBeTruthy();
    expect(screen.getAllByText("Detener después de esta")).toHaveLength(1);
    await act(async () => pendientes[0]({ ok: true, url: "u1" }));
    expect(screen.getByText("Creando imagen 2 de 4…")).toBeTruthy();
    fireEvent.click(screen.getByText("Detener después de esta"));
    await act(async () => pendientes[1]({ ok: true, url: "u2" }));
    expect(screen.getByText("Se detuvo después de 2 imágenes")).toBeTruthy();
    expect(screen.queryByText("Creando imagen 3 de 4…")).toBeNull();
  });

  // React 18 (vitest) no mantiene pendiente una transición async; en la app (React
  // de Next) sí. Por eso se fija el estado «pendiente» a mano.
  it("Diagnóstico: barra solo mientras la transición está pendiente", () => {
    pendiente = true;
    render(<DiagnosticoPublicacion cuentaMlId="c" itemId="MCO1" />);
    expect(screen.getByText("Consultando diagnóstico…")).toBeTruthy();
    cleanup();
    pendiente = false;
    render(<DiagnosticoPublicacion cuentaMlId="c" itemId="MCO1" />);
    expect(screen.queryByText("Consultando diagnóstico…")).toBeNull();
  });
});
