import { describe, expect, it } from "vitest";
import { contarEstados, filtrarFilas, leerFiltros, paginar, type FilaVenta } from "./filtros";

const fila = (o: Partial<FilaVenta>): FilaVenta => ({ cuentaId: "c", cuentaNick: "n", siteId: "MCO", ordenId: "200", fecha: "2026-11-20T10:00:00Z", titulo: "Collar", foto: null, precio: 1, cantidad: 1, moneda: "COP", estadoVenta: "paid", estadoMensaje: "respondido", ...o });

describe("filtros de mensajes", () => {
  it("lee la URL con lista blanca", () => {
    expect(leerFiltros({ estado: "hack", desde: "no", pagina: "-3", q: "  a " })).toEqual({ estado: null, q: "a", desde: null, pagina: 1 });
    expect(leerFiltros({ estado: "sin_leer", desde: "2026-11-01", pagina: "2" })).toMatchObject({ estado: "sin_leer", desde: "2026-11-01", pagina: 2 });
  });
  it("filtra por estado, búsqueda y fecha", () => {
    const filas = [fila({ ordenId: "1", estadoMensaje: "sin_leer" }), fila({ ordenId: "2", titulo: "Arnés", fecha: "2026-10-01T00:00:00Z" })];
    expect(contarEstados(filas)).toEqual({ sin_leer: 1, por_responder: 0, respondido: 1 });
    expect(filtrarFilas(filas, { estado: "sin_leer", q: "", desde: null, pagina: 1 })).toHaveLength(1);
    expect(filtrarFilas(filas, { estado: null, q: "arn", desde: null, pagina: 1 })[0].ordenId).toBe("2");
    expect(filtrarFilas(filas, { estado: null, q: "", desde: "2026-11-01", pagina: 1 })).toHaveLength(1);
  });
  it("pagina de a 10 y no se pasa del final", () => {
    const r = paginar(Array.from({ length: 25 }, (_, i) => i), 9);
    expect(r.paginas).toBe(3);
    expect(r.pagina).toBe(3);
    expect(r.filas).toHaveLength(5);
  });
});
