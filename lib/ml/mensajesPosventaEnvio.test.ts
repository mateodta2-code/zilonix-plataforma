import { beforeEach, describe, expect, it, vi } from "vitest";

const escribirMl = vi.fn();
vi.mock("@/lib/ml/cliente", async () => ({ ...(await vi.importActual<object>("@/lib/ml/cliente")), escribirMl: (...a: unknown[]) => escribirMl(...a) }));

import { enviarMensajeVentaMl } from "./mensajesPosventaEnvio";

const base = { token: "t", siteId: "MCO", packOOrden: "200", vendedorId: "111", compradorId: "222", texto: "Hola", archivos: [] };
const foto = (nombre = "a.jpg", tipo = "image/jpeg", bytes = 10) => ({ nombre, tipo, bytes: new ArrayBuffer(bytes) });

beforeEach(() => {
  escribirMl.mockReset();
});

describe("enviarMensajeVentaMl", () => {
  it("con 1 foto: sube el adjunto y luego envía con su id", async () => {
    escribirMl.mockResolvedValueOnce({ ok: true, status: 200, data: { id: "ADJ1" } }).mockResolvedValueOnce({ ok: true, status: 201, data: {} });
    const r = await enviarMensajeVentaMl({ ...base, archivos: [foto()] });
    expect(r).toEqual({ ok: true });
    expect(escribirMl.mock.calls[0][0]).toContain("/messages/attachments?tag=post_sale&site_id=MCO");
    expect(escribirMl.mock.calls[0][3]).toBeInstanceOf(FormData);
    expect(escribirMl.mock.calls[1][0]).toContain("/messages/packs/200/sellers/111?tag=post_sale");
    expect(escribirMl.mock.calls[1][3]).toMatchObject({ from: { user_id: "111" }, to: { user_id: "222" }, text: "Hola", attachments: ["ADJ1"] });
  });

  it("archivo muy grande o de tipo no permitido se rechaza antes de llamar a ML", async () => {
    expect((await enviarMensajeVentaMl({ ...base, archivos: [foto("a.jpg", "image/jpeg", 26 * 1024 * 1024)] })).ok).toBe(false);
    expect((await enviarMensajeVentaMl({ ...base, archivos: [foto("a.exe", "application/x-msdownload")] })).ok).toBe(false);
    expect((await enviarMensajeVentaMl({ ...base, archivos: [foto(), foto(), foto(), foto()] })).ok).toBe(false);
    expect((await enviarMensajeVentaMl({ ...base, texto: "x".repeat(351) })).ok).toBe(false);
    expect(escribirMl).not.toHaveBeenCalled();
  });

  it("si ML rechaza, devuelve un mensaje simple", async () => {
    escribirMl.mockResolvedValue({ ok: false, status: 400, data: null });
    const r = await enviarMensajeVentaMl(base);
    expect(r.ok).toBe(false);
  });
});
