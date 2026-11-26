import { afterEach, describe, expect, it, vi } from "vitest";
import { consultarSaldoMp, montoMpATexto } from "./saldo";

// Issue #422 (Bloque 2) — saldo de Mercado Pago con fetch simulado.

function respuesta(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function simularFetch(impl: () => Promise<Response>) {
  const espia = vi.fn(impl);
  vi.stubGlobal("fetch", espia);
  return espia;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("consultarSaldoMp", () => {
  it("200 con disponible y por liberar", async () => {
    const espia = simularFetch(async () => respuesta(200, { available_balance: 1500.5, unavailable_balance: 200, currency_id: "COP", total_amount: 1700.5 }));
    const r = await consultarSaldoMp("TOKEN-SECRETO", "123 456");
    expect(r).toEqual({ estado: "ok", disponible: "1500.50", porLiberar: "200.00", moneda: "COP" });

    const [url, init] = espia.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.mercadopago.com/users/123%20456/mercadopago_account/balance");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-SECRETO");
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("200 con decimales largos redondea a 2 decimales", async () => {
    simularFetch(async () => respuesta(200, { available_balance: 1234.5678, unavailable_balance: 0.005, currency_id: "ARS" }));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "ok", disponible: "1234.57", porLiberar: "0.01", moneda: "ARS" });
  });

  it("200 sin unavailable_balance deja porLiberar en null", async () => {
    simularFetch(async () => respuesta(200, { available_balance: 0, currency_id: "MXN" }));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "ok", disponible: "0.00", porLiberar: null, moneda: "MXN" });
  });

  it("200 sin available_balance o sin moneda válida es respuesta inválida", async () => {
    simularFetch(async () => respuesta(200, { unavailable_balance: 10, currency_id: "COP" }));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_respuesta_invalida", status: 200 });
    simularFetch(async () => respuesta(200, { available_balance: 10, currency_id: "pesos colombianos" }));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_respuesta_invalida", status: 200 });
  });

  it("403 expone status y un código corto de Mercado Pago", async () => {
    simularFetch(async () => respuesta(403, { error: "forbidden", message: "texto largo con datos que no se expone" }));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_403", status: 403, codigoMp: "forbidden" });
  });

  it("401 sin body JSON", async () => {
    simularFetch(async () => respuesta(401, "no autorizado"));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_401", status: 401 });
  });

  it("500 descarta un código que no pasa la lista blanca", async () => {
    simularFetch(async () => respuesta(500, { code: "esto tiene espacios y <html>" }));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_http", status: 500 });
  });

  it("error de red o timeout", async () => {
    simularFetch(async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    });
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_red" });
    simularFetch(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_red" });
  });

  it("JSON inválido en un 200", async () => {
    simularFetch(async () => respuesta(200, "{no es json"));
    expect(await consultarSaldoMp("t", "1")).toEqual({ estado: "error", codigo: "mp_respuesta_invalida", status: 200 });
  });

  it("nunca devuelve el token en el resultado", async () => {
    simularFetch(async () => respuesta(403, { error: "TOKEN-SECRETO" }));
    const r = await consultarSaldoMp("TOKEN-SECRETO-LARGO", "1");
    expect(JSON.stringify(r)).not.toContain("TOKEN-SECRETO-LARGO");
  });
});

describe("montoMpATexto", () => {
  it("formatea compatible con aCentavos", () => {
    expect(montoMpATexto(10)).toBe("10.00");
    expect(montoMpATexto(-3.456)).toBe("-3.46");
    expect(montoMpATexto(-0.001)).toBe("0.00");
    expect(montoMpATexto("99.9")).toBe("99.90");
    expect(montoMpATexto(Number.NaN)).toBeNull();
    expect(montoMpATexto(Infinity)).toBeNull();
    expect(montoMpATexto(null)).toBeNull();
    expect(montoMpATexto("")).toBeNull();
  });
});
