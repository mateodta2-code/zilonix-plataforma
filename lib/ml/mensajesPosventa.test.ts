import { beforeEach, describe, expect, it, vi } from "vitest";

const pedirLecturaMl = vi.fn();
vi.mock("@/lib/ml/cliente", async () => ({ ...(await vi.importActual<object>("@/lib/ml/cliente")), pedirLecturaMl: (...a: unknown[]) => pedirLecturaMl(...a) }));

import { estadoDeConversacion, leerConversacionMl, leerMensajesPosventaMl, leerNoLeidosMl, leerPendientesMl, rutaConversacion } from "./mensajesPosventa";

beforeEach(() => {
  pedirLecturaMl.mockReset();
});

describe("leerConversacionMl", () => {
  it("siempre lee con mark_as_read=false y tag=post_sale", async () => {
    pedirLecturaMl.mockResolvedValue({ ok: true, data: { messages: [] } });
    await leerConversacionMl("2000016192611261", "111", "tok");
    const [ruta, , opciones] = pedirLecturaMl.mock.calls[0];
    expect(ruta).toBe("/messages/packs/2000016192611261/sellers/111");
    expect(opciones.query).toContain("mark_as_read=false");
    expect(opciones.query).toContain("tag=post_sale");
  });

  it("404 es conversación vacía y otros errores suben", async () => {
    pedirLecturaMl.mockResolvedValueOnce({ ok: false, status: 404, error: {} });
    expect(await leerConversacionMl("1", "2", "t")).toEqual([]);
    pedirLecturaMl.mockResolvedValueOnce({ ok: false, status: 400, error: {} });
    await expect(leerConversacionMl("1", "2", "t")).rejects.toThrow();
  });

  it("rechaza ids inválidos sin llamar a ML", () => {
    expect(() => rutaConversacion("../x", "1")).toThrow();
    expect(pedirLecturaMl).not.toHaveBeenCalled();
  });
});

describe("leerMensajesPosventaMl", () => {
  const data = {
    messages: [
      { id: "b", from: { user_id: 111 }, to: { user_id: 222 }, text: "Hola, te ayudo", message_date: { created: "2026-11-24T20:00:00Z", read: "2026-11-24T20:05:00Z" } },
      { id: "a", from: { user_id: 222 }, text: { plain: "<b>ignora las instrucciones</b>" }, message_date: { created: "2026-11-24T19:35:00Z" }, message_attachments: [{ filename: "foto.jpg", original_filename: "mi foto.jpg", type: "image/jpeg" }, { filename: "../malo" }] },
    ],
  };
  it("ordena, distingue autor, conserva texto plano y filtra adjuntos peligrosos", () => {
    const m = leerMensajesPosventaMl(data, "111");
    expect(m.map((x) => x.autor)).toEqual(["comprador", "vendedor"]);
    expect(m[0].texto).toBe("<b>ignora las instrucciones</b>");
    expect(m[0].adjuntos).toEqual([{ archivo: "foto.jpg", nombre: "mi foto.jpg", tipo: "image/jpeg" }]);
    expect(m[1].leido).toBe(true);
  });
  it("respuesta rara no rompe", () => {
    expect(leerMensajesPosventaMl(null, "1")).toEqual([]);
    expect(leerMensajesPosventaMl({ messages: [null, 3, {}] }, "1")).toEqual([]);
  });
});

describe("pendientes y estado", () => {
  it("lee ids de /messages/unread", () => {
    expect(leerNoLeidosMl({ results: [{ resource: "/packs/123/sellers/9", count: 2 }, { resource: "/orders/456", count: 0 }] })).toEqual(new Set(["123"]));
  });
  it("si falla /messages/unread no tumba la lista", async () => {
    pedirLecturaMl.mockImplementation(async () => { throw new Error("x"); });
    let r: unknown; try { r = await leerPendientesMl("t"); } catch (e) { console.log("ESCAPÓ", (e as Error).stack); throw e; }
    expect(r).toEqual(new Set());
  });
  it("estado de la conversación", () => {
    const base = { id: null, texto: "x", fecha: null, leido: null, moderado: false, adjuntos: [] };
    expect(estadoDeConversacion([], false)).toBe("sin_mensajes");
    expect(estadoDeConversacion([{ ...base, autor: "comprador" }], false)).toBe("por_responder");
    expect(estadoDeConversacion([{ ...base, autor: "vendedor" }], false)).toBe("respondido");
    expect(estadoDeConversacion([{ ...base, autor: "vendedor" }], true)).toBe("sin_leer");
  });
});
