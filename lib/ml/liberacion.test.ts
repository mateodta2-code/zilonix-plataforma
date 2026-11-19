import { describe, expect, it, vi } from "vitest";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlSinPermisoAppError, type RespuestaLecturaMl } from "@/lib/ml/cliente";
// Estas pruebas son puras: la base no se toca (sincronizarLiberacion se
// prueba contra Postgres en db/rls-por-cobrar.test.ts).
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));

import { combinarLiberaciones, leerLiberacionPago, liberacionDesdePago, pagosPorConsultar, type LectorMl } from "./liberacion";

// Issue #422 — fecha de liberación de Mercado Libre. Los JSON son de
// ejemplo, recortados a los campos que se leen (documentación de ML /
// Mercado Pago); falta confirmarlos con una venta real en staging.

const PAGO_V1 = {
  id: 91234567890,
  status: "approved",
  currency_id: "COP",
  transaction_amount: 80000,
  date_approved: "2026-11-10T10:00:00.000-04:00",
  money_release_date: "2026-11-24T10:00:00.000-04:00",
  money_release_status: "pending",
  transaction_details: { net_received_amount: 66930.5, total_paid_amount: 80000 },
};

const COLLECTION = {
  collection: {
    id: 91234567890,
    status: "approved",
    currency_id: "COP",
    transaction_amount: 80000,
    net_received_amount: 66930.5,
    money_release_date: "2026-11-24T10:00:00.000-04:00",
    money_release_status: "pending",
  },
};

const ok = <T>(data: T): RespuestaLecturaMl<T> => ({ ok: true, data });

describe("liberacionDesdePago", () => {
  it("lee /v1/payments/{id} (neto en transaction_details)", () => {
    expect(liberacionDesdePago(PAGO_V1)).toEqual({ estado: "pending", fecha: "2026-11-24T10:00:00.000-04:00", neto: "66930.50" });
  });

  it("lee /collections/{id}, envuelto o no", () => {
    const esperado = { estado: "pending", fecha: "2026-11-24T10:00:00.000-04:00", neto: "66930.50" };
    expect(liberacionDesdePago(COLLECTION)).toEqual(esperado);
    expect(liberacionDesdePago(COLLECTION.collection)).toEqual(esperado);
  });

  it("sin los campos, deja todo vacío en vez de inventar", () => {
    expect(liberacionDesdePago({ id: 1, money_release_date: "no-es-fecha" })).toEqual({ estado: null, fecha: null, neto: null });
    expect(liberacionDesdePago(null)).toBeNull();
  });
});

describe("pagosPorConsultar", () => {
  const pagos = [
    { id: 1, status: "approved" },
    { id: 2, status: "approved", money_release_status: "released" },
    { id: 3, status: "rejected" },
    { id: 1, status: "approved" },
  ];

  it("solo los aprobados sin liberar, sin repetir", () => {
    expect(pagosPorConsultar("paid", pagos, null)).toEqual(["1"]);
    expect(pagosPorConsultar("paid", pagos, "pending")).toEqual(["1"]);
  });

  it("no gasta llamadas si la venta ya se liberó o se canceló", () => {
    expect(pagosPorConsultar("paid", pagos, "released")).toEqual([]);
    expect(pagosPorConsultar("cancelled", pagos, null)).toEqual([]);
  });
});

describe("combinarLiberaciones", () => {
  it("liberada solo si todos los pagos lo están", () => {
    expect(
      combinarLiberaciones([
        { estado: "released", fecha: "2026-11-01T10:00:00.000-04:00", neto: "100.00" },
        { estado: "released", fecha: "2026-11-03T10:00:00.000-04:00", neto: "50.00" },
      ])
    ).toEqual({ estado: "released", fecha: new Date("2026-11-03T14:00:00.000Z"), montoPorLiberar: "0.00" });
  });

  it("pendiente: suma el neto de los pendientes y toma la fecha más tardía", () => {
    expect(
      combinarLiberaciones([
        { estado: "released", fecha: "2026-11-30T10:00:00.000-04:00", neto: "100.00" },
        { estado: "pending", fecha: "2026-11-24T10:00:00.000-04:00", neto: "66930.50" },
        { estado: "pending", fecha: "2026-11-26T10:00:00.000-04:00", neto: "10.25" },
      ])
    ).toEqual({ estado: "pending", fecha: new Date("2026-11-26T14:00:00.000Z"), montoPorLiberar: "66940.75" });
    expect(combinarLiberaciones([])).toBeNull();
  });
});

describe("leerLiberacionPago", () => {
  it("usa /v1/payments/{id} si responde", async () => {
    const leer = vi.fn(async () => ok(PAGO_V1)) as unknown as LectorMl;
    expect(await leerLiberacionPago(leer, "91234567890")).toMatchObject({ tipo: "ok", liberacion: { neto: "66930.50" } });
    expect(leer).toHaveBeenCalledWith("/v1/payments/91234567890");
  });

  it("con 401 o 403 prueba /collections/{id}", async () => {
    for (const error of [new MlNoAutorizadoError(), new MlSinPermisoAppError("/v1/payments", "forbidden")]) {
      const rutas: string[] = [];
      const leer = (async (ruta: string) => {
        rutas.push(ruta);
        if (ruta.startsWith("/v1/")) throw error;
        return ok(COLLECTION);
      }) as LectorMl;
      expect(await leerLiberacionPago(leer, "91234567890")).toMatchObject({ tipo: "ok", liberacion: { estado: "pending" } });
      expect(rutas).toEqual(["/v1/payments/91234567890", "/collections/91234567890"]);
    }
  });

  it("si ninguno deja, avisa sin_permiso; un 404 es sin_dato; un 429 se propaga", async () => {
    const negado = (async () => {
      throw new MlSinPermisoAppError("/x", null);
    }) as LectorMl;
    expect(await leerLiberacionPago(negado, "1")).toEqual({ tipo: "sin_permiso" });

    const noExiste = (async () => ({ ok: false, status: 404, error: { code: null, message: null } })) as LectorMl;
    expect(await leerLiberacionPago(noExiste, "1")).toEqual({ tipo: "sin_dato" });

    const limite = (async () => {
      throw new LimiteMercadoLibreError(null);
    }) as LectorMl;
    await expect(leerLiberacionPago(limite, "1")).rejects.toBeInstanceOf(LimiteMercadoLibreError);

    expect(await leerLiberacionPago(negado, "abc")).toEqual({ tipo: "sin_dato" });
  });
});
