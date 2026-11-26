import { afterEach, describe, expect, it, vi } from "vitest";
import { URL_PAYMENTS_SEARCH, URL_RELEASE_REPORT_LIST, verificarEndpointsMp } from "./saldo";

// Issue #422 (Bloque 2, diagnóstico) — endpoints oficiales de Mercado Pago
// con fetch simulado.

function respuesta(status: number, body: unknown): Response {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// Responde según la URL: liberaciones (release_report/list) o pagos.
function simularFetch(liberaciones: () => Promise<Response>, pagos: () => Promise<Response>) {
  const espia = vi.fn(async (url: string) => (url === URL_RELEASE_REPORT_LIST ? liberaciones() : pagos()));
  vi.stubGlobal("fetch", espia);
  return espia;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verificarEndpointsMp", () => {
  it("200/200 con cantidades, headers y URLs oficiales", async () => {
    const espia = simularFetch(
      async () => respuesta(200, [{ file_name: "a.csv" }, { file_name: "b.csv" }]),
      async () => respuesta(200, { paging: { total: 50 }, results: [{ id: 1 }] })
    );
    const r = await verificarEndpointsMp("TOKEN-SECRETO");
    expect(r).toEqual({
      liberaciones: { ok: true, status: 200, cantidad: 2 },
      pagos: { ok: true, status: 200, cantidad: 1 },
    });

    expect(espia).toHaveBeenCalledTimes(2);
    const urls = espia.mock.calls.map((c) => c[0]).sort();
    expect(urls).toEqual([URL_RELEASE_REPORT_LIST, URL_PAYMENTS_SEARCH].sort());
    expect(URL_RELEASE_REPORT_LIST).toBe("https://api.mercadopago.com/v1/account/release_report/list");
    expect(URL_PAYMENTS_SEARCH).toBe("https://api.mercadopago.com/v1/payments/search?limit=1");
    for (const llamada of espia.mock.calls) {
      const init = (llamada as unknown as [string, RequestInit])[1];
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer TOKEN-SECRETO");
      expect(init.cache).toBe("no-store");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("403 en liberaciones y 200 en pagos", async () => {
    simularFetch(
      async () => respuesta(403, { error: "forbidden", message: "texto largo con datos que no se expone" }),
      async () => respuesta(200, { results: [] })
    );
    expect(await verificarEndpointsMp("t")).toEqual({
      liberaciones: { ok: false, status: 403, codigo: "mp_403", codigoMp: "forbidden" },
      pagos: { ok: true, status: 200, cantidad: 0 },
    });
  });

  it("200 en liberaciones y 403 en pagos", async () => {
    simularFetch(
      async () => respuesta(200, []),
      async () => respuesta(403, { code: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES", message: "no" })
    );
    expect(await verificarEndpointsMp("t")).toEqual({
      liberaciones: { ok: true, status: 200, cantidad: 0 },
      pagos: { ok: false, status: 403, codigo: "mp_403", codigoMp: "PA_UNAUTHORIZED_RESULT_FROM_POLICIES" },
    });
  });

  it("401 sin body JSON y 500 con un código que no pasa la lista blanca", async () => {
    simularFetch(
      async () => respuesta(401, "no autorizado"),
      async () => respuesta(500, { code: "esto tiene espacios y <html>" })
    );
    expect(await verificarEndpointsMp("t")).toEqual({
      liberaciones: { ok: false, status: 401, codigo: "mp_401" },
      pagos: { ok: false, status: 500, codigo: "mp_http" },
    });
  });

  it("timeout o error de red", async () => {
    simularFetch(
      async () => {
        throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
      },
      async () => {
        throw new TypeError("fetch failed");
      }
    );
    expect(await verificarEndpointsMp("t")).toEqual({
      liberaciones: { ok: false, codigo: "mp_red" },
      pagos: { ok: false, codigo: "mp_red" },
    });
  });

  it("JSON inesperado en un 200: ok sin cantidad", async () => {
    simularFetch(
      async () => respuesta(200, { no: "es un array" }),
      async () => respuesta(200, "{no es json")
    );
    expect(await verificarEndpointsMp("t")).toEqual({
      liberaciones: { ok: true, status: 200 },
      pagos: { ok: true, status: 200 },
    });
    simularFetch(
      async () => respuesta(200, "null"),
      async () => respuesta(200, { results: "no es array" })
    );
    expect(await verificarEndpointsMp("t")).toEqual({
      liberaciones: { ok: true, status: 200 },
      pagos: { ok: true, status: 200 },
    });
  });

  it("nunca devuelve el token ni el body en el resultado", async () => {
    simularFetch(
      async () => respuesta(403, { error: "forbidden", message: "TOKEN-SECRETO-LARGO" }),
      async () => respuesta(200, { results: [{ payer: { email: "alguien@example.com" } }] })
    );
    const texto = JSON.stringify(await verificarEndpointsMp("TOKEN-SECRETO-LARGO"));
    expect(texto).not.toContain("TOKEN-SECRETO-LARGO");
    expect(texto).not.toContain("alguien@example.com");
  });
});
