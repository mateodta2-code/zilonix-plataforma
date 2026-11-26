import { afterEach, describe, expect, it, vi } from "vitest";
import { aMontoDosDecimales, buscarPagosPendientesMp, clasificarPagoMp, ErrorPagosMp, URL_BUSQUEDA_PAGOS } from "./pagos-por-cobrar";

// Issue #422 (por cobrar) — búsqueda de pagos sin liberar en Mercado Pago.

const COLLECTOR = "123456";
const AHORA = new Date("2026-11-26T15:00:00.000Z");
const TOKEN = "token-de-prueba";

function pago(extra: Record<string, unknown> = {}) {
  return {
    id: 1001,
    collector_id: 123456,
    status: "approved",
    money_release_status: "pending",
    money_release_date: "2026-12-05T10:00:00.000-04:00",
    currency_id: "COP",
    order: { id: 2000001 },
    transaction_details: { net_received_amount: 95000.5 },
    ...extra,
  };
}

function respuesta(results: unknown[], total: number, status = 200): Response {
  return new Response(JSON.stringify({ results, paging: { total, limit: 50, offset: 0 } }), { status });
}

function parametros(llamada: unknown[]): URLSearchParams {
  return new URL(String(llamada[0])).searchParams;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("clasificarPagoMp", () => {
  it("aprobado sin liberar → por_liberar, con neto a 2 decimales y orden", () => {
    expect(clasificarPagoMp(pago(), COLLECTOR, AHORA)).toEqual({
      pagoIdExterno: "1001",
      ordenIdExterno: "2000001",
      estado: "approved",
      estadoLiberacion: "pending",
      fechaLiberacion: new Date("2026-12-05T14:00:00.000Z"),
      montoNeto: "95000.50",
      moneda: "COP",
      tipo: "por_liberar",
    });
  });

  it("in_mediation → retenido", () => {
    expect(clasificarPagoMp(pago({ status: "in_mediation", money_release_status: "not_released" }), COLLECTOR, AHORA)?.tipo).toBe("retenido");
  });

  it("aprobado con fecha de liberación ya pasada sigue por_liberar (la vencida la marca por-cobrar)", () => {
    expect(clasificarPagoMp(pago({ money_release_date: "2026-11-01T00:00:00Z" }), COLLECTOR, AHORA)?.tipo).toBe("por_liberar");
  });

  it("descarta liberados, devueltos, contracargos, otros estados y pagos donde la cuenta fue compradora", () => {
    expect(clasificarPagoMp(pago({ money_release_status: "released" }), COLLECTOR, AHORA)).toBeNull();
    expect(clasificarPagoMp(pago({ status: "refunded" }), COLLECTOR, AHORA)).toBeNull();
    expect(clasificarPagoMp(pago({ status: "charged_back" }), COLLECTOR, AHORA)).toBeNull();
    expect(clasificarPagoMp(pago({ status: "pending" }), COLLECTOR, AHORA)).toBeNull();
    expect(clasificarPagoMp(pago({ collector_id: 999 }), COLLECTOR, AHORA)).toBeNull();
    expect(clasificarPagoMp(pago({ currency_id: "cop" }), COLLECTOR, AHORA)).toBeNull();
    expect(clasificarPagoMp(null, COLLECTOR, AHORA)).toBeNull();
  });

  it("sin neto: monto null (no se adivina)", () => {
    expect(clasificarPagoMp(pago({ transaction_details: {} }), COLLECTOR, AHORA)?.montoNeto).toBeNull();
  });
});

describe("aMontoDosDecimales", () => {
  it("formatea sin errores de float y redondea la mitad lejos de cero", () => {
    expect(aMontoDosDecimales(0.1)).toBe("0.10");
    expect(aMontoDosDecimales(1234567.891)).toBe("1234567.89");
    expect(aMontoDosDecimales("10.005")).toBe("10.01");
    expect(aMontoDosDecimales(-10.005)).toBe("-10.01");
    expect(aMontoDosDecimales("99999999999999999.99")).toBe("99999999999999999.99");
    expect(aMontoDosDecimales(1e21)).toBeNull();
    expect(aMontoDosDecimales(Number.NaN)).toBeNull();
    expect(aMontoDosDecimales(undefined)).toBeNull();
  });
});

describe("buscarPagosPendientesMp", () => {
  it("pagina con limit=50 hasta paging.total, manda collector.id y token, y deduplica por id", async () => {
    const pagina1 = Array.from({ length: 50 }, (_, i) => pago({ id: i + 1 }));
    const pagina2 = [pago({ id: 51 }), pago({ id: 1 })]; // el 1 repetido
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(pagina1, 52))
      .mockResolvedValueOnce(respuesta(pagina2, 52))
      .mockResolvedValueOnce(respuesta([pago({ id: 1, status: "in_mediation" }), pago({ id: 900, status: "in_mediation" })], 2));
    vi.stubGlobal("fetch", fetchMock);

    const pagos = await buscarPagosPendientesMp(TOKEN, COLLECTOR, AHORA);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(pagos).toHaveLength(52);
    expect(pagos.find((p) => p.pagoIdExterno === "1")?.tipo).toBe("retenido");

    const [a1, a2, b] = fetchMock.mock.calls.map(parametros);
    expect(String(fetchMock.mock.calls[0][0]).startsWith(`${URL_BUSQUEDA_PAGOS}?`)).toBe(true);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store", headers: { Authorization: `Bearer ${TOKEN}` } });
    expect(a1.get("collector.id")).toBe(COLLECTOR);
    expect(a1.get("status")).toBe("approved");
    expect(a1.get("range")).toBe("money_release_date");
    expect(a1.get("begin_date")).toBe("2026-09-27T15:00:00.000Z");
    expect(a1.get("end_date")).toBe("2027-05-25T15:00:00.000Z");
    expect(a1.get("sort")).toBe("money_release_date");
    expect(a1.get("criteria")).toBe("asc");
    expect([a1.get("limit"), a1.get("offset")]).toEqual(["50", "0"]);
    expect(a2.get("offset")).toBe("50");
    expect(b.get("status")).toBe("in_mediation");
    expect(b.get("range")).toBe("date_created");
    expect(b.get("begin_date")).toBe("NOW-365DAYS");
    expect(b.get("collector.id")).toBe(COLLECTOR);
  });

  it("si MP responde 400 al end_date futuro, reintenta con date_approved de los últimos 90 días", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 400 }))
      .mockResolvedValueOnce(respuesta([pago()], 1))
      .mockResolvedValueOnce(respuesta([], 0));
    vi.stubGlobal("fetch", fetchMock);

    const pagos = await buscarPagosPendientesMp(TOKEN, COLLECTOR, AHORA);
    expect(pagos).toHaveLength(1);
    const respaldo = parametros(fetchMock.mock.calls[1]);
    expect(respaldo.get("range")).toBe("date_approved");
    expect(respaldo.get("begin_date")).toBe("NOW-90DAYS");
    expect(respaldo.get("end_date")).toBe("NOW");
    expect(respaldo.get("criteria")).toBe("desc");
  });

  it("filtra pagos de otro collector y descarta liberados / devueltos", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          respuesta([pago({ id: 1 }), pago({ id: 2, collector_id: 777 }), pago({ id: 3, money_release_status: "released" }), pago({ id: 4, status: "refunded" })], 4)
        )
        .mockResolvedValueOnce(respuesta([], 0))
    );
    const pagos = await buscarPagosPendientesMp(TOKEN, COLLECTOR, AHORA);
    expect(pagos.map((p) => p.pagoIdExterno)).toEqual(["1"]);
  });

  it("corta en 40 páginas por consulta aunque paging.total diga más", async () => {
    const fetchMock = vi.fn((url: string) => {
      const offset = Number(new URL(url).searchParams.get("offset"));
      const status = new URL(url).searchParams.get("status");
      if (status === "in_mediation") return Promise.resolve(respuesta([], 0));
      return Promise.resolve(respuesta(Array.from({ length: 50 }, (_, i) => pago({ id: offset + i + 1 })), 1_000_000));
    });
    vi.stubGlobal("fetch", fetchMock);
    const pagos = await buscarPagosPendientesMp(TOKEN, COLLECTOR, AHORA);
    expect(pagos).toHaveLength(2000);
    expect(fetchMock).toHaveBeenCalledTimes(41);
  });

  it("errores como códigos cortos: 401, 403, 429, otro status y red", async () => {
    for (const [status, codigo] of [
      [401, "mp_401"],
      [403, "mp_403"],
      [429, "mp_429"],
      [500, "mp_http"],
    ] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
      await expect(buscarPagosPendientesMp(TOKEN, COLLECTOR, AHORA)).rejects.toMatchObject({ codigo, status });
    }
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const error = await buscarPagosPendientesMp(TOKEN, COLLECTOR, AHORA).catch((e) => e);
    expect(error).toBeInstanceOf(ErrorPagosMp);
    expect(error.codigo).toBe("mp_red");
    expect(error.message).not.toContain(TOKEN);
  });
});
