import { beforeEach, describe, expect, it, vi } from "vitest";

const escribirMl = vi.fn();
vi.mock("@/lib/ml/cliente", async () => ({ ...(await vi.importActual<object>("@/lib/ml/cliente")), escribirMl: (...a: unknown[]) => escribirMl(...a) }));

import { enviarMensajeReclamoMl, puedeEscribirEnReclamo } from "./reclamosMensajes";

const base = { token: "t", reclamoId: "5619539113", etapa: "claim", accionesVendedor: ["send_message_to_complainant"], texto: "Hola", archivos: [] };

beforeEach(() => {
  escribirMl.mockReset();
});

describe("enviarMensajeReclamoMl", () => {
  it("etapa claim → complainant; etapa dispute → mediator", async () => {
    escribirMl.mockResolvedValue({ ok: true, status: 200, data: {} });
    await enviarMensajeReclamoMl(base);
    expect(escribirMl.mock.calls[0][3]).toMatchObject({ receiver_role: "complainant", message: "Hola" });
    await enviarMensajeReclamoMl({ ...base, etapa: "dispute", accionesVendedor: ["send_message_to_mediator"] });
    expect(escribirMl.mock.calls[1][0]).toContain("/claims/5619539113/actions/message");
    expect(escribirMl.mock.calls[1][3]).toMatchObject({ receiver_role: "mediator" });
  });

  it("sin la acción disponible no llama a ML", async () => {
    expect(puedeEscribirEnReclamo("dispute", ["send_message_to_complainant"])).toBe(false);
    const r = await enviarMensajeReclamoMl({ ...base, accionesVendedor: [] });
    expect(r.ok).toBe(false);
    expect(escribirMl).not.toHaveBeenCalled();
  });

  it("adjunto: sube con file_name y lo manda en attachments; >5 MB se rechaza antes", async () => {
    escribirMl.mockResolvedValueOnce({ ok: true, status: 200, data: { file_name: "F1.png" } }).mockResolvedValueOnce({ ok: true, status: 200, data: {} });
    await enviarMensajeReclamoMl({ ...base, archivos: [{ nombre: "a.png", tipo: "image/png", bytes: new ArrayBuffer(10) }] });
    expect(escribirMl.mock.calls[0][0]).toContain("/claims/5619539113/attachments");
    expect(escribirMl.mock.calls[1][3]).toMatchObject({ attachments: ["F1.png"] });
    escribirMl.mockClear();
    const r = await enviarMensajeReclamoMl({ ...base, archivos: [{ nombre: "a.png", tipo: "image/png", bytes: new ArrayBuffer(6 * 1024 * 1024) }] });
    expect(r.ok).toBe(false);
    expect(escribirMl).not.toHaveBeenCalled();
  });
});
