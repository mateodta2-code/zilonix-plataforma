// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompetidoresExtension } from "./CompetidoresExtension";

const guardadosMock = vi.fn();
const guardarMock = vi.fn();
vi.mock("./actions", () => ({
  competidoresGuardadosAction: (...a: unknown[]) => guardadosMock(...a),
  guardarCompetidoresAction: (...a: unknown[]) => guardarMock(...a),
}));

const PROPIA = { itemId: "MCO1342632705", titulo: "Luces Led Inalámbricas Para Cuadros Con Control Táctil Rgb Negro", foto: null, enlace: null, precio: 185931, precioOriginal: null, envioGratis: true, full: false };

function guardado(extra: Record<string, unknown> = {}) {
  return {
    termino: "luces led",
    candidatos: 1,
    leidoTs: "2026-11-28T14:00:00.000Z",
    competidores: [
      {
        itemId: "MCO111111111",
        link: "https://articulo.mercadolibre.com.co/MCO-111111111-lampara-_JM",
        titulo: "Lámpara Led Con Sensor",
        foto: "https://http2.mlstatic.com/D_NQ_NP_123-V.webp",
        vendedor: "DIRECTOACASABOG",
        precio: 25757, precioAnterior: null, descuentoPorcentaje: null, vendidos: 1000, vendidosExacto: false, calificacion: 4.6, numeroOpiniones: 157,
        esCatalogo: false, full: true, envioGratis: true, inventario: 50, inventarioAproximado: true, fotos: 8, descripcion: true,
        vendidosEstimados: null, antiguedadDias: 400, ventasMes: 80, facturacionMes: 2000000, leidoDeFicha: true, manual: false, actualizadoTs: "2026-11-28T14:00:00.000Z",
        ...extra,
      },
    ],
  };
}

function montar() {
  document.documentElement.setAttribute("data-zilonix-extension", "1");
  return render(<CompetidoresExtension propia={PROPIA} cuentaMlId="c1" siteId="MCO" idioma="es-CO" />);
}

beforeEach(() => {
  guardarMock.mockResolvedValue({ ok: true, leidoTs: "2026-11-28T15:00:00.000Z" });
});
afterEach(() => {
  cleanup();
  guardadosMock.mockReset();
  guardarMock.mockReset();
  document.documentElement.removeAttribute("data-zilonix-extension");
  vi.restoreAllMocks();
});

describe("CompetidoresExtension", () => {
  it("muestra lo guardado: tienda, disponibles (+50) y qué tan parecido es", async () => {
    guardadosMock.mockResolvedValue({ ok: true, guardado: guardado() });
    montar();
    await act(async () => {});
    expect(screen.getByText("DIRECTOACASABOG")).toBeTruthy();
    expect(screen.getByText("+50")).toBeTruthy();
    expect(screen.getByText(/Poco parecido/)).toBeTruthy();
  });

  it("quitar un competidor lo saca de la lista y lo guarda sin él", async () => {
    guardadosMock.mockResolvedValue({ ok: true, guardado: guardado() });
    montar();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: /Quitar Lámpara Led Con Sensor/ }));
    await act(async () => {});
    expect(guardarMock).toHaveBeenCalledTimes(1);
    expect(guardarMock.mock.calls[0][0].competidores).toEqual([]);
    expect(screen.getByText(/No hay competidores guardados/)).toBeTruthy();
  });

  it("agregar por link pide a la extensión leer SOLO ese link y rechaza links ajenos", async () => {
    guardadosMock.mockResolvedValue({ ok: true, guardado: null });
    const enviar = vi.spyOn(window, "postMessage");
    montar();
    await act(async () => {});
    const campo = screen.getByLabelText("Link de un competidor en Mercado Libre");
    fireEvent.change(campo, { target: { value: "https://evil.com/MCO-1" } });
    fireEvent.submit(campo.closest("form")!);
    expect(screen.getByText(/Pega un link de una publicación de Mercado Libre/)).toBeTruthy();
    expect(enviar).not.toHaveBeenCalled();

    const bueno = "https://www.mercadolibre.com.co/lampara/up/MCO222222222";
    fireEvent.change(campo, { target: { value: bueno } });
    fireEvent.submit(campo.closest("form")!);
    expect(enviar).toHaveBeenCalledTimes(1);
    const mensaje = enviar.mock.calls[0][0] as { tipo: string; payload: { links: string[]; tituloPropio: string } };
    expect(mensaje.tipo).toBe("iniciar-competidores");
    expect(mensaje.payload.links).toEqual([bueno]);
    expect(mensaje.payload.tituloPropio).toBe(PROPIA.titulo);
  });

  it("al llegar la ficha del link, el competidor queda agregado, fijo, y guardado", async () => {
    guardadosMock.mockResolvedValue({ ok: true, guardado: guardado() });
    vi.spyOn(window, "postMessage");
    montar();
    await act(async () => {});
    const campo = screen.getByLabelText("Link de un competidor en Mercado Libre");
    fireEvent.change(campo, { target: { value: "https://articulo.mercadolibre.com.co/MCO-222222222-otra-_JM" } });
    fireEvent.submit(campo.closest("form")!);
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent("message", {
          source: window,
          origin: window.location.origin,
          data: {
            fuente: "zilonix-extension",
            tipo: "competidores-leidos",
            payload: {
              excluirItemId: PROPIA.itemId,
              termino: "",
              modo: "links",
              candidatos: 1,
              competidores: [{ ...guardado().competidores[0], itemId: "MCO222222222", link: "https://articulo.mercadolibre.com.co/MCO-222222222-otra-_JM", titulo: "Otra lámpara", leidoDeFicha: true }],
            },
          },
        })
      );
    });
    expect(guardarMock).toHaveBeenCalledTimes(1);
    const lista = guardarMock.mock.calls[0][0].competidores;
    expect(lista).toHaveLength(2);
    expect(lista[1]).toMatchObject({ itemId: "MCO222222222", manual: true });
    expect(screen.getByText("Otra lámpara")).toBeTruthy();
  });

  it("la foto se agranda al pasar el mouse y se abre grande al hacer clic", async () => {
    guardadosMock.mockResolvedValue({ ok: true, guardado: guardado() });
    montar();
    await act(async () => {});
    const boton = screen.getByRole("button", { name: /Ampliar foto: Lámpara Led Con Sensor/ });
    fireEvent.mouseEnter(boton);
    expect(document.querySelector('img[src$="-O.webp"]')).toBeTruthy();
    fireEvent.click(boton);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
