// @vitest-environment jsdom
//
// Issue "ocultar imprimir en recogidas" — mismo patrón que
// CopiarTexto.test.tsx/FotoConZoom.test.tsx (@testing-library/react +
// jsdom). Este componente no importa nada de servidor (ni "./actions"
// ni lib/ml/despachos.ts), corre sin Postgres.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImpresionMasivaForm, type FilaImpresionMasiva } from "./ImpresionMasivaForm";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FILAS: FilaImpresionMasiva[] = [
  { id: "d1", shipmentIdExterno: "9001", logisticType: "self_service", status: "ready_to_ship", actualizadoTs: new Date("2026-10-20T15:00:00Z") },
];

describe("ImpresionMasivaForm — pide con fetch, nunca abre una pestaña con JSON crudo (punto 3)", () => {
  it("si Mercado Libre rechaza el lote (ej. una venta ya recogida), muestra el error ACÁ — nunca abre una pestaña", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "Mercado Libre ya no deja imprimir esta guía porque el transportador ya la recogió — es un bloqueo de Mercado Libre, no hay forma de saltarlo." }) })
    );

    render(<ImpresionMasivaForm filas={FILAS} etiquetaTipo={{ self_service: "Flex" }} />);
    fireEvent.click(screen.getByText("Imprimir etiquetas seleccionadas"));

    expect(await screen.findByText("Mercado Libre ya no deja imprimir esta guía porque el transportador ya la recogió — es un bloqueo de Mercado Libre, no hay forma de saltarlo.")).not.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });

  it("si el lote sí se imprime, abre una pestaña con un blob: URL propio", async () => {
    const open = vi.fn();
    vi.stubGlobal("open", open);
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:fake-url") });
    const pdf = new Blob(["%PDF-fake"], { type: "application/pdf" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => pdf }));

    render(<ImpresionMasivaForm filas={FILAS} etiquetaTipo={{ self_service: "Flex" }} />);
    fireEvent.click(screen.getByText("Imprimir etiquetas seleccionadas"));

    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("blob:fake-url", "_blank"));
  });
});

describe("ImpresionMasivaForm — modo reimprimir (guías ya impresas)", () => {
  const YA_IMPRESAS: FilaImpresionMasiva[] = [
    { ...FILAS[0], producto: "2 x Gorra azul", etiquetaImpresaTs: new Date("2026-11-13T20:00:00Z") },
  ];

  it("las casillas vienen desmarcadas, muestra el producto y el botón dice Reimprimir", () => {
    render(<ImpresionMasivaForm modo="reimprimir" filas={YA_IMPRESAS} etiquetaTipo={{ self_service: "Flex" }} />);
    expect((screen.getByLabelText("Seleccionar envío 9001") as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("2 x Gorra azul")).not.toBeNull();
    expect(screen.getByText("Reimprimir seleccionadas")).not.toBeNull();
  });

  it("manda modo=reimprimir al Route Handler junto con lo marcado", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<ImpresionMasivaForm modo="reimprimir" filas={YA_IMPRESAS} etiquetaTipo={{ self_service: "Flex" }} />);
    fireEvent.click(screen.getByLabelText("Seleccionar envío 9001"));
    fireEvent.click(screen.getByText("Reimprimir seleccionadas"));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const cuerpo = fetchMock.mock.calls[0][1].body as FormData;
    expect(cuerpo.get("modo")).toBe("reimprimir");
    expect(cuerpo.getAll("shipmentId")).toEqual(["9001"]);
  });
});

describe("ImpresionMasivaForm — formato de impresión", () => {
  it("'Imprimir en sticker 10x15' manda formato=sticker; el botón normal manda formato=normal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: "x" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<ImpresionMasivaForm filas={FILAS} etiquetaTipo={{ self_service: "Flex" }} />);
    fireEvent.click(screen.getByText("Imprimir en sticker 10x15"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((fetchMock.mock.calls[0][1].body as FormData).get("formato")).toBe("sticker");
    // Los botones quedan deshabilitados mientras corre el primer envío.
    await screen.findByText("x");

    fireEvent.click(screen.getByText("Imprimir etiquetas seleccionadas"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect((fetchMock.mock.calls[1][1].body as FormData).get("formato")).toBe("normal");
  });
});

describe("ImpresionMasivaForm — estado traducido", () => {
  it("muestra el estado en español cuando viene traducido, nunca 'ready_to_ship'", () => {
    render(<ImpresionMasivaForm filas={[{ ...FILAS[0], estado: "Listo para despachar" }]} etiquetaTipo={{ self_service: "Flex" }} />);
    expect(screen.getByText("Listo para despachar")).not.toBeNull();
    expect(screen.queryByText("ready_to_ship")).toBeNull();
  });
});
