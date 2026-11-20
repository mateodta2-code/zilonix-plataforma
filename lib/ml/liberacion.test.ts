import { beforeEach, describe, expect, it, vi } from "vitest";
import { LimiteMercadoLibreError, MlNoAutorizadoError, MlSinPermisoAppError, type RespuestaLecturaMl } from "@/lib/ml/cliente";
// Estas pruebas son puras: la base no se toca (sincronizarLiberacion se
// prueba contra Postgres en db/rls-por-cobrar.test.ts).
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: vi.fn() }));

import {
  combinarLiberaciones,
  leerLiberacionPago,
  liberacionDesdePago,
  olvidarPermisosLiberacion,
  pagosPorConsultar,
  type LectorMl,
} from "./liberacion";

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

  it("un pendiente sin neto deja el monto vacío (no 0): la venta sigue por cobrar", () => {
    expect(
      combinarLiberaciones([
        { estado: "pending", fecha: "2026-11-24T10:00:00.000-04:00", neto: "100.00" },
        { estado: "pending", fecha: null, neto: null },
      ])
    ).toEqual({ estado: "pending", fecha: new Date("2026-11-24T14:00:00.000Z"), montoPorLiberar: null });
  });
});

describe("leerLiberacionPago", () => {
  beforeEach(() => olvidarPermisosLiberacion());

  it("usa /v1/payments/{id} si responde", async () => {
    const leer = vi.fn(async () => ok(PAGO_V1)) as unknown as LectorMl;
    expect(await leerLiberacionPago(leer, "91234567890", "cuenta-1")).toMatchObject({ tipo: "ok", liberacion: { neto: "66930.50" } });
    expect(leer).toHaveBeenCalledWith("/v1/payments/91234567890");
  });

  it("con 401 prueba /collections/{id} y no lo recuerda (es del token, no del permiso)", async () => {
    const rutas: string[] = [];
    const leer = (async (ruta: string) => {
      rutas.push(ruta);
      if (ruta.startsWith("/v1/")) throw new MlNoAutorizadoError();
      return ok(COLLECTION);
    }) as LectorMl;
    expect(await leerLiberacionPago(leer, "1", "cuenta-1")).toMatchObject({ tipo: "ok", liberacion: { estado: "pending" } });
    expect(await leerLiberacionPago(leer, "2", "cuenta-1")).toMatchObject({ tipo: "ok" });
    expect(rutas).toEqual(["/v1/payments/1", "/collections/1", "/v1/payments/2", "/collections/2"]);
  });

  it("recuerda por cuenta el 403 de /v1/payments: la siguiente orden va directo a /collections", async () => {
    const rutas: string[] = [];
    const leer = (async (ruta: string) => {
      rutas.push(ruta);
      if (ruta.startsWith("/v1/")) throw new MlSinPermisoAppError("/v1/payments", "forbidden");
      return ok(COLLECTION);
    }) as LectorMl;
    await leerLiberacionPago(leer, "1", "cuenta-1");
    await leerLiberacionPago(leer, "2", "cuenta-1");
    // Otra cuenta no hereda el 403.
    await leerLiberacionPago(leer, "3", "cuenta-2");
    expect(rutas).toEqual(["/v1/payments/1", "/collections/1", "/collections/2", "/v1/payments/3", "/collections/3"]);
  });

  it("sin permiso en las dos: un solo log por cuenta, sin token, y no vuelve a llamar hasta que pasan las horas", async () => {
    const TOKEN = "APP_USR-token-secreto-123";
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const leer = vi.fn(async () => {
      throw new MlSinPermisoAppError("/x", null);
    }) as unknown as LectorMl;
    const t0 = Date.parse("2026-11-19T15:00:00Z");
    for (const id of ["1", "2", "3"]) expect(await leerLiberacionPago(leer, id, "cuenta-1", t0)).toEqual({ tipo: "sin_permiso" });
    expect(leer).toHaveBeenCalledTimes(2);
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(String(aviso.mock.calls[0][0])).toContain("cuenta-1");
    expect(JSON.stringify(aviso.mock.calls)).not.toContain(TOKEN);

    // 7 h después la cuenta se vuelve a probar (por si habilitaron el permiso).
    await leerLiberacionPago(leer, "4", "cuenta-1", t0 + 7 * 3_600_000);
    expect(leer).toHaveBeenCalledTimes(4);
    aviso.mockRestore();
  });

  it("un 404 es sin_dato, un id inválido no llama y un 429 se propaga", async () => {
    const noExiste = (async () => ({ ok: false, status: 404, error: { code: null, message: null } })) as LectorMl;
    expect(await leerLiberacionPago(noExiste, "1", "cuenta-1")).toEqual({ tipo: "sin_dato" });
    expect(await leerLiberacionPago(noExiste, "abc", "cuenta-1")).toEqual({ tipo: "sin_dato" });
    const limite = (async () => {
      throw new LimiteMercadoLibreError(null);
    }) as LectorMl;
    await expect(leerLiberacionPago(limite, "1", "cuenta-1")).rejects.toBeInstanceOf(LimiteMercadoLibreError);
  });
});
