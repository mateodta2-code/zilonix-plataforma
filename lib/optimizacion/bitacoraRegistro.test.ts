import { beforeEach, describe, expect, it, vi } from "vitest";

const guardadas = vi.hoisted(() => [] as unknown[]);
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: async () => [] }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: async (_tx: unknown, e: unknown) => guardadas.push(e) }));

import { armarDetalleCambio, compactarFotos, estadoDeCambio, leerCuentaDeDetalle, leerFotosCompactas, quitarCuentaDeDetalle, registrarCambioOptimizacion } from "./bitacora";

const CUENTA = "11111111-2222-3333-4444-555555555555";

describe("marcador de cuenta en el detalle", () => {
  it("lo agrega al final y se puede leer y quitar", () => {
    const d = armarDetalleCambio("Cambió el precio de MCO1 (TIENDA).", CUENTA);
    expect(d).toBe(`Cambió el precio de MCO1 (TIENDA). [cuenta:${CUENTA}]`);
    expect(leerCuentaDeDetalle(d)).toBe(CUENTA);
    expect(quitarCuentaDeDetalle(d)).toBe("Cambió el precio de MCO1 (TIENDA).");
  });
  it("las filas viejas sin marcador siguen igual", () => {
    expect(leerCuentaDeDetalle("Cambió el precio de MCO1 (TIENDA).")).toBeNull();
    expect(quitarCuentaDeDetalle("Texto viejo")).toBe("Texto viejo");
    expect(leerCuentaDeDetalle(null)).toBeNull();
  });
  it("no duplica el marcador ni acepta una cuenta inválida", () => {
    expect(armarDetalleCambio(armarDetalleCambio("x", CUENTA), CUENTA)).toBe(`x [cuenta:${CUENTA}]`);
    expect(armarDetalleCambio("x", "no-es-uuid")).toBe("x");
  });
});

describe("fotos compactas", () => {
  it("una por línea y con tope de largo", () => {
    expect(leerFotosCompactas(compactarFotos(["A1", "https://x/y.jpg"]))).toEqual(["A1", "https://x/y.jpg"]);
    expect(compactarFotos(["aaaa", "bbbb", "cccc"], 9)).toBe("aaaa\nbbbb");
  });
});

describe("registrarCambioOptimizacion", () => {
  beforeEach(() => void (guardadas.length = 0));
  it("guarda en auditoría la publicación, la cuenta, antes y después", async () => {
    await registrarCambioOptimizacion({} as never, {
      empresaId: "e1", usuarioId: "u1", cuentaMlId: CUENTA, cuentaNickname: "TIENDA", itemId: "MCO1",
      accion: "cambiar_precio_publicacion", valorAnterior: "10", valorNuevo: "12", detalle: "Cambió el precio.",
    });
    expect(guardadas).toEqual([
      { empresaId: "e1", usuarioId: "u1", actorTipo: "persona", accion: "cambiar_precio_publicacion", entidad: "publicacion_ml", entidadId: "MCO1", detalle: `Cambió el precio. [cuenta:${CUENTA}]`, valorAnterior: "10", valorNuevo: "12" },
    ]);
  });
});

describe("estadoDeCambio", () => {
  it("midiendo, listo, sin revisar y revisado", () => {
    const rev = { resultado: "sirvio" as const, comentario: null, usuario: null, ts: new Date() };
    expect(estadoDeCambio("2026-11-20", "2026-11-25", null)).toBe("midiendo");
    expect(estadoDeCambio("2026-11-14", "2026-11-25", null)).toBe("listo");
    expect(estadoDeCambio("2026-10-01", "2026-11-25", null)).toBe("sin_revisar");
    expect(estadoDeCambio("2026-11-10", "2026-11-25", rev)).toBe("revisado");
  });
});
