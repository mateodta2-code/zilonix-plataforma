// @vitest-environment jsdom
//
// Issue "ocultar imprimir en recogidas" — mismo patrón que
// CopiarTexto.test.tsx/FotoConZoom.test.tsx (@testing-library/react +
// jsdom): useRouter() corre durante el render (no en un efecto) y
// revienta fuera de un App Router montado de verdad, se mockea.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TarjetaDespachoCliente, type TarjetaDespachoProps } from "./TarjetaDespachoCliente";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function propsBase(extra: Partial<TarjetaDespachoProps> = {}): TarjetaDespachoProps {
  return {
    id: "despacho-1",
    logisticType: "self_service",
    status: "shipped",
    estadoTraducido: "En camino",
    despachadoTs: null,
    guiaVistaTs: new Date("2026-10-20T10:00:00Z"),
    cuentaNickname: "VENDEDOR_PRUEBA",
    pedidoIdExterno: "ORD-1",
    fechaPedido: new Date("2026-10-20T15:00:00Z"),
    comprador: null,
    bodegaAsignada: null,
    items: [],
    etiquetaTipo: "⚡ Flex",
    esFlex: true,
    chipPlazo: null,
    estadoPlazo: null,
    estadoEnvioTexto: "En camino",
    origenDespacho: null,
    imprimible: true,
    puedeModificar: true,
    ventanaDeshacerMs: 10 * 60 * 1000,
    ...extra,
  };
}

describe("TarjetaDespachoCliente — 'Ver guía'/'Marcar despachado' según imprimible (issue 'ocultar imprimir en recogidas')", () => {
  it("un envío ya recogido (imprimible=false) NO muestra 'Ver guía' ni 'Marcar despachado' — muestra el aviso de guía no disponible", () => {
    render(<TarjetaDespachoCliente {...propsBase({ origenDespacho: "recogido_transportadora", imprimible: false })} />);
    expect(screen.queryByText("Marcar despachado")).toBeNull();
    expect(screen.queryByText("Ver guía (PDF)")).toBeNull();
    expect(screen.queryByText("Ver guía (sticker)")).toBeNull();
    expect(screen.getByText("Guía ya no disponible: la transportadora ya la recogió.")).not.toBeNull();
  });

  it("un envío todavía no recogido (imprimible=true) sí muestra 'Ver guía' y 'Marcar despachado'", () => {
    render(<TarjetaDespachoCliente {...propsBase({ origenDespacho: null, status: "ready_to_ship", imprimible: true })} />);
    expect(screen.getByText("Marcar despachado")).not.toBeNull();
    expect(screen.getByText("Ver guía (PDF)")).not.toBeNull();
    expect(screen.getByText("Ver guía (sticker)")).not.toBeNull();
    expect(screen.queryByText("Guía ya no disponible: la transportadora ya la recogió.")).toBeNull();
  });

  it("uno marcado en Seller (despachado_ts puesto) muestra Deshacer, sin ninguno de los otros", () => {
    render(<TarjetaDespachoCliente {...propsBase({ origenDespacho: "marcado_en_seller", despachadoTs: new Date(), imprimible: false })} />);
    expect(screen.queryByText("Marcar despachado")).toBeNull();
    expect(screen.queryByText("Guía ya no disponible: la transportadora ya la recogió.")).toBeNull();
    expect(screen.getByText("Deshacer")).not.toBeNull();
  });
});

describe("TarjetaDespachoCliente — abrirGuia pide con fetch, nunca window.open directo (punto 3)", () => {
  it("si Mercado Libre rechaza la guía, el error se muestra ACÁ — nunca abre una pestaña", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Mercado Libre ya no deja imprimir esta guía porque el transportador ya la recogió — es un bloqueo de Mercado Libre, no hay forma de saltarlo." }),
      })
    );

    render(<TarjetaDespachoCliente {...propsBase({ imprimible: true })} />);
    fireEvent.click(screen.getByText("Ver guía (PDF)"));

    expect(await screen.findByText("Mercado Libre ya no deja imprimir esta guía porque el transportador ya la recogió — es un bloqueo de Mercado Libre, no hay forma de saltarlo.")).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("si la guía viene bien, abre una pestaña con un blob: URL propio — nunca la URL del Route Handler", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake-url") });
    const pdf = new Blob(["%PDF-fake"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => pdf }));

    render(<TarjetaDespachoCliente {...propsBase({ imprimible: true })} />);
    fireEvent.click(screen.getByText("Ver guía (PDF)"));

    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("blob:fake-url", "_blank"));
  });
});
