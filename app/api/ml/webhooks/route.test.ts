import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recibirAviso } from "@/lib/ml/avisos";
import { intentarProcesarAvisoAhora } from "@/lib/ml/trabajador";
import { POST } from "./route";

// Fix real (2026-10-21) — esta ruta es pública en el middleware (ver
// lib/rutas-publicas.ts), así que cualquiera en internet puede
// llamarla: estas pruebas cubren las dos capas nuevas (tamaño del
// cuerpo, application_id) sin dejar de cumplir la regla de siempre
// "responder 200 aunque el aviso no sea válido, nunca hacer
// reintentar a Mercado Libre de más".
vi.mock("@/lib/ml/avisos", () => ({ recibirAviso: vi.fn(async () => ({ resultado: "guardado", avisoId: "aviso-test-id" })) }));
// Issue "despachos no aparecen solos" (Refs #49) — el intento síncrono
// se prueba aparte, con detalle, en lib/ml/trabajador.test.ts; acá solo
// importa que la ruta lo llame (o no) según corresponda, nunca que
// rompa el 200.
vi.mock("@/lib/ml/trabajador", () => ({ intentarProcesarAvisoAhora: vi.fn(async () => "procesado") }));

const ML_CLIENT_ID_REAL = "ml-client-id-fake-ci";

function peticion(body: unknown, headers: Record<string, string> = {}): NextRequest {
  const texto = JSON.stringify(body);
  return new NextRequest("https://x.test/api/ml/webhooks", {
    method: "POST",
    body: texto,
    headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(texto)), ...headers },
  });
}

describe("POST /api/ml/webhooks (fix middleware, 2026-10-21)", () => {
  const envOriginal = process.env.ML_CLIENT_ID;
  afterEach(() => {
    process.env.ML_CLIENT_ID = envOriginal;
    vi.clearAllMocks();
  });

  it("cuerpo incompleto → 200 { ok: false }, nunca llama recibirAviso", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    const res = await POST(peticion({ resource: "/orders/1" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(recibirAviso).not.toHaveBeenCalled();
  });

  it("application_id ajeno → 200 sin insertar", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    const res = await POST(peticion({ resource: "/orders/1", user_id: 123, topic: "orders_v2", sent: new Date().toISOString(), application_id: "otra-app-cualquiera" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(recibirAviso).not.toHaveBeenCalled();
  });

  it("sin ML_CLIENT_ID configurado, se rechaza todo (cerrado por defecto)", async () => {
    process.env.ML_CLIENT_ID = "";
    const res = await POST(peticion({ resource: "/orders/1", user_id: 123, topic: "orders_v2", sent: new Date().toISOString(), application_id: ML_CLIENT_ID_REAL }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(recibirAviso).not.toHaveBeenCalled();
  });

  it("aviso real y bien formado, con nuestro application_id → se guarda y se intenta procesar al instante", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    const res = await POST(
      peticion({ resource: "/orders/1", user_id: 123, topic: "orders_v2", sent: new Date().toISOString(), application_id: ML_CLIENT_ID_REAL })
    );
    expect(res.status).toBe(200);
    expect(recibirAviso).toHaveBeenCalledOnce();
    // Issue "despachos no aparecen solos" (Refs #49) — "orders_v2"/
    // "shipments" nuevos (resultado "guardado", con avisoId) disparan
    // el intento síncrono, con el id real de la fila que se acaba de
    // guardar — nunca con datos del cuerpo del aviso.
    expect(intentarProcesarAvisoAhora).toHaveBeenCalledWith("aviso-test-id");
    const body = await res.json();
    expect(body).toEqual({ ok: true, resultado: "guardado" });
  });

  it("aviso duplicado (ya se había guardado) → nunca intenta procesar de nuevo", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    vi.mocked(recibirAviso).mockResolvedValueOnce({ resultado: "duplicado", avisoId: null });
    const res = await POST(
      peticion({ resource: "/orders/1", user_id: 123, topic: "orders_v2", sent: new Date().toISOString(), application_id: ML_CLIENT_ID_REAL })
    );
    expect(res.status).toBe(200);
    expect(intentarProcesarAvisoAhora).not.toHaveBeenCalled();
  });

  it("aviso de una cuenta desconocida (nunca se guardó) → nunca intenta procesar", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    vi.mocked(recibirAviso).mockResolvedValueOnce({ resultado: "cuenta_desconocida", avisoId: null });
    const res = await POST(
      peticion({ resource: "/orders/1", user_id: 123, topic: "orders_v2", sent: new Date().toISOString(), application_id: ML_CLIENT_ID_REAL })
    );
    expect(res.status).toBe(200);
    expect(intentarProcesarAvisoAhora).not.toHaveBeenCalled();
  });

  it("aviso guardado de un tema que no es de venta (ej. 'items') → nunca intenta procesar al instante", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    const res = await POST(
      peticion({ resource: "/items/1", user_id: 123, topic: "items", sent: new Date().toISOString(), application_id: ML_CLIENT_ID_REAL })
    );
    expect(res.status).toBe(200);
    expect(intentarProcesarAvisoAhora).not.toHaveBeenCalled();
  });

  it("si intentarProcesarAvisoAhora rechaza (bug, lo que sea), igual responde 200 — nunca rompe el webhook", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    vi.mocked(intentarProcesarAvisoAhora).mockRejectedValueOnce(new Error("explota"));
    const res = await POST(
      peticion({ resource: "/orders/1", user_id: 123, topic: "orders_v2", sent: new Date().toISOString(), application_id: ML_CLIENT_ID_REAL })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, resultado: "guardado" });
  });

  it("cuerpo real de 20KB, SIN Content-Length → 200 {ok:false, motivo:'cuerpo demasiado grande'}, nunca llama recibirAviso", async () => {
    process.env.ML_CLIENT_ID = ML_CLIENT_ID_REAL;
    // Mentir con un Content-Length chico no alcanzaría para engañar el
    // tope real (ya no se usa ese header) — el cuerpo de verdad pesa
    // 20KB y la petición no manda Content-Length en absoluto (simula
    // chunked, el caso que el header no cubre).
    const cuerpoGrande = JSON.stringify({ resource: "/orders/1", relleno: "x".repeat(20 * 1024) });
    const req = new NextRequest("https://x.test/api/ml/webhooks", {
      method: "POST",
      body: cuerpoGrande,
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, motivo: "cuerpo demasiado grande" });
    expect(recibirAviso).not.toHaveBeenCalled();
  });
});
