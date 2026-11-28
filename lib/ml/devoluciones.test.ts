import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ml/cuentas", () => ({ listarCuentasConectadas: vi.fn(), obtenerAccessTokenVigente: vi.fn() }));
vi.mock("@/lib/ml/preguntas", () => ({ motivoCuentaSinRevisar: () => "x" }));

const { armarQueryBusquedaReclamos, leerReclamosConDevolucionMl, leerDevolucionMl, leerRevisionesMl, leerCostoEnvioMl, estadoSimpleDevolucion, ROTULOS_ESTADO_DEVOLUCION, rotuloEnvioDevolucion } =
  await import("@/lib/ml/devoluciones");

describe("leerReclamosConDevolucionMl", () => {
  it("sin related_entities no descarta; con lista sin return sí; type returns siempre queda", () => {
    const r = leerReclamosConDevolucionMl({
      paging: { total: 5 },
      data: [
        { id: 1, related_entities: ["return"], resource: "order", resource_id: 99, status: "opened" },
        { id: 2, related_entities: ["reviews"] },
        { id: 3 },
        { id: 4, related_entities: [] },
        { id: 5, type: "returns", related_entities: [] },
      ],
    });
    expect(r.total).toBe(5);
    expect(r.leidos).toBe(5);
    expect(r.reclamos.map((c) => c.id)).toEqual(["1", "3", "5"]);
  });
  it("respuesta inesperada no rompe", () => {
    expect(leerReclamosConDevolucionMl(null).reclamos).toEqual([]);
  });
});

describe("leerDevolucionMl", () => {
  it("lee estado, subtipo y envío de vuelta", () => {
    const d = leerDevolucionMl({
      id: 55,
      status: "opened",
      subtype: "low_cost",
      shipments: [{ shipment_id: 7, status: "shipped", tracking_number: "ABC", destination: { name: "seller_address" } }],
    });
    expect(d?.id).toBe("55");
    expect(d?.envios[0]).toMatchObject({ envioId: "7", estado: "shipped", seguimiento: "ABC", destino: "seller_address" });
  });
  it("sin datos útiles es null", () => {
    expect(leerDevolucionMl({})).toBeNull();
    expect(leerDevolucionMl(null)).toBeNull();
  });
});

describe("revisiones y costo", () => {
  it("lee revisiones con o sin envoltorio", () => {
    expect(leerRevisionesMl({ reviews: [{ status: "done", method: "triage", date_created: "2026-11-01" }] })).toHaveLength(1);
    expect(leerRevisionesMl("x")).toEqual([]);
  });
  it("lee el costo; sin monto es null", () => {
    expect(leerCostoEnvioMl({ amount: 12.5, currency_id: "COP" })).toEqual({ monto: 12.5, moneda: "COP" });
    expect(leerCostoEnvioMl({ currency_id: "COP" })).toBeNull();
  });
});

describe("estadoSimpleDevolucion", () => {
  const base = { id: "1", subtipo: null, estadoDinero: null, creada: null, actualizada: null, cerrada: null };
  it("traduce a palabras simples", () => {
    expect(estadoSimpleDevolucion({ ...base, estado: "opened", envios: [{ envioId: "1", estado: "shipped", tipo: null, seguimiento: null, destino: null }] }, null)).toBe("en_camino");
    expect(estadoSimpleDevolucion({ ...base, estado: "opened", envios: [{ envioId: "1", estado: "delivered", tipo: null, seguimiento: null, destino: null }] }, [])).toBe("llego");
    expect(estadoSimpleDevolucion({ ...base, estado: "opened", envios: [{ envioId: "1", estado: "delivered", tipo: null, seguimiento: null, destino: null }] }, [{ fecha: null, estado: "done", metodo: null }])).toBe("revisada");
    expect(estadoSimpleDevolucion({ ...base, estado: "closed", envios: [] }, null)).toBe("cerrada");
    expect(estadoSimpleDevolucion(null, null)).toBe("en_proceso");
    expect(ROTULOS_ESTADO_DEVOLUCION.llego).toBe("Llegó, revísala");
  });
  it("rotula el envío y deja pasar un código desconocido", () => {
    expect(rotuloEnvioDevolucion("shipped")).toBe("En camino");
    expect(rotuloEnvioDevolucion("raro")).toBe("raro");
  });
});

describe("armarQueryBusquedaReclamos (28-nov: v2, la forma confirmada)", () => {
  it("solo status=opened y limit 30: sin players, range ni sort (la v1 con eso respondía 400)", () => {
    const q = armarQueryBusquedaReclamos();
    expect(q).toBe("?status=opened&limit=30");
    expect(q).not.toContain("players");
    expect(q).not.toContain("range");
  });
});
