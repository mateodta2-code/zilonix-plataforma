// @vitest-environment jsdom
// Promo-C (Refs #573) — la fila lista varias promociones y solo se envían las marcadas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PaginaPromocionesReal } from "./PaginaPromocionesReal";

afterEach(() => cleanup());

const CUENTA = "11111111-1111-1111-1111-111111111111";
function promo(tipo: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    tipoPromocion: tipo, promotionIdMl: id, estadoMl: "candidate", esCompartida: false, soloEnMl: false, puedeSalirApi: true, precioOriginal: 100, precioActual: null,
    precioMinimo: 60, precioSugerido: 80, maxDiscountedPrice: null, gananciaEstimada: null, cumpleReglas: true, accionSugerida: "participar", motivoRevisarManual: null,
    reglaAdicionalMotivo: null, ...extra,
  };
}
const FILA = {
  itemId: "MLM1", cuentaMlId: CUENTA, nicknameCuenta: "Mi Tienda", siteId: "MLM", tituloProducto: "Producto 1", thumbnail: null, skuCodigo: null, precioOriginal: 100, stock: 1,
  tieneVariantes: false, estado: "en_promocion", motivoError: null,
  promociones: [promo("DEAL", "A"), promo("PRICE_DISCOUNT", "B"), promo("SMART", "C", { estadoMl: "started", precioActual: 70 }), promo("DOD", "D", { estadoMl: "started", puedeSalirApi: false })],
};

let llamadas: { url: string; cuerpo: Record<string, unknown> }[];

beforeEach(() => {
  llamadas = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (String(url).startsWith("/api/ml/promociones/publicaciones?")) {
        return { ok: true, json: async () => ({ filas: [FILA], conteosLote: { todas: 1, enPromocion: 1, sinPromocion: 0, conError: 0 }, cursorSiguiente: null }) };
      }
      llamadas.push({ url, cuerpo: JSON.parse(init?.body ?? "{}") });
      return { ok: true, json: async () => ({ ok: true }) };
    })
  );
});

describe("Aplicar a este producto", () => {
  it("lista todas las promociones y envía solo las marcadas", async () => {
    render(<PaginaPromocionesReal cuentas={[{ id: CUENTA, nickname: "Mi Tienda", siteId: "MLM" }]} puedeEjecutar resumenMaestraSku={{ total: 0, actualizadoTs: null }} />);
    fireEvent.click(await screen.findByText("Producto 1"));
    expect(screen.getByText("Campaña tradicional")).toBeTruthy();
    expect(screen.getByText("Descuento por porcentaje")).toBeTruthy();
    // la que ML no deja salir por API queda deshabilitada
    expect((screen.getByLabelText("Salir de Oferta del día") as HTMLInputElement).disabled).toBe(true);

    fireEvent.click(screen.getByLabelText("Participar en Campaña tradicional"));
    fireEvent.click(screen.getByLabelText("Salir de Precio inteligente"));
    vi.stubGlobal("confirm", vi.fn(() => true));
    fireEvent.click(screen.getByText("Aplicar a este producto"));

    await waitFor(() => expect(llamadas).toHaveLength(2));
    expect(llamadas.map((l) => [l.url, l.cuerpo.promotionIdMl])).toEqual([
      ["/api/ml/promociones/publicaciones/participar", "A"],
      ["/api/ml/promociones/participando/salir", "C"],
    ]);
    expect(llamadas[0].cuerpo.precioElegido).toBe(80);
  });
});
