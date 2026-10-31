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

    render(<ImpresionMasivaForm filas={FILAS} total={1} tamanoPagina={25} etiquetaTipo={{ self_service: "Flex" }} />);
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

    render(<ImpresionMasivaForm filas={FILAS} total={1} tamanoPagina={25} etiquetaTipo={{ self_service: "Flex" }} />);
    fireEvent.click(screen.getByText("Imprimir etiquetas seleccionadas"));

    await vi.waitFor(() => expect(open).toHaveBeenCalledWith("blob:fake-url", "_blank"));
  });
});
