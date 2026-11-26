import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/panel-contexto", () => ({ obtenerContextoPanel: vi.fn(async () => ({ usuario: { id: "u1" }, activa: { id: "e1" } })) }));
vi.mock("@/lib/cloudinary", () => ({ CloudinaryNoConfiguradoError: class extends Error {} }));
vi.mock("@/lib/soporte/subirImagenes", () => ({ subirImagenesTicket: vi.fn(async (_e: string, t: string, b: Uint8Array[]) => b.map((_, i) => `zilonix-soporte/e1/${t}-${i}`)) }));
vi.mock("@/lib/soporte/tickets", async () => {
  const { SoporteError } = await import("@/lib/soporte/validacion");
  return {
    SoporteError,
    requiereMiembroActivo: vi.fn(async () => {}),
    crearTicket: vi.fn(async (_u: string, _e: string, _a: string, _m: string, _mo: string, o: { ticketId: string }) => o.ticketId),
    obtenerMiTicket: vi.fn(async () => ({ estado: "abierto" })),
    responderMiTicket: vi.fn(async () => {}),
  };
});

import { subirImagenesTicket } from "@/lib/soporte/subirImagenes";
import { crearTicket, obtenerMiTicket, responderMiTicket } from "@/lib/soporte/tickets";
import { abrirTicketAction, responderTicketAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const conImagenes = (...bytes: number[][]) => {
  const d = new FormData();
  bytes.forEach((b, i) => d.append("imagen", new File([new Uint8Array(b)], `c${i}.jpg`, { type: "image/jpeg" })));
  return d;
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

// Tickets de soporte con capturas (25-nov).
describe("abrirTicketAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("texto inválido o imágenes inválidas: no sube nada", async () => {
    await expect(abrirTicketAction("x", "corto", "Pedidos", conImagenes(JPEG))).resolves.toMatchObject({ ok: false });
    await expect(abrirTicketAction("Asunto válido", "Mensaje suficientemente largo", "Pedidos", conImagenes([0x89, 0x50, 0x4e, 0x47]))).resolves.toMatchObject({ ok: false });
    await expect(abrirTicketAction("Asunto válido", "Mensaje suficientemente largo", "Pedidos", conImagenes(JPEG, JPEG, JPEG, JPEG))).resolves.toMatchObject({ ok: false });
    expect(subirImagenesTicket).not.toHaveBeenCalled();
    expect(crearTicket).not.toHaveBeenCalled();
  });

  it("con imágenes: las sube con el id del ticket nuevo y crea el ticket con esos ids", async () => {
    const r = await abrirTicketAction("Asunto válido", "Mensaje suficientemente largo", "Pedidos", conImagenes(JPEG, JPEG));
    expect(r).toMatchObject({ ok: true });
    const [, ticketId] = vi.mocked(subirImagenesTicket).mock.calls[0];
    expect(vi.mocked(crearTicket).mock.calls[0][5]).toEqual({ ticketId, imagenes: [`zilonix-soporte/e1/${ticketId}-0`, `zilonix-soporte/e1/${ticketId}-1`] });
  });

  it("sin imágenes funciona igual que antes", async () => {
    await expect(abrirTicketAction("Asunto válido", "Mensaje suficientemente largo", "Pedidos")).resolves.toMatchObject({ ok: true });
    expect(subirImagenesTicket).not.toHaveBeenCalled();
  });
});

describe("responderTicketAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ticket ajeno o resuelto: no sube nada", async () => {
    vi.mocked(obtenerMiTicket).mockResolvedValueOnce(null);
    await expect(responderTicketAction(T, "Hola de nuevo", conImagenes(JPEG))).resolves.toMatchObject({ ok: false });
    vi.mocked(obtenerMiTicket).mockResolvedValueOnce({ estado: "resuelto" } as never);
    await expect(responderTicketAction(T, "Hola de nuevo", conImagenes(JPEG))).resolves.toMatchObject({ ok: false });
    expect(subirImagenesTicket).not.toHaveBeenCalled();
    expect(responderMiTicket).not.toHaveBeenCalled();
  });

  it("con imágenes en un ticket abierto: sube y responde con sus ids", async () => {
    await expect(responderTicketAction(T, "Hola de nuevo", conImagenes(JPEG))).resolves.toEqual({ ok: true });
    expect(responderMiTicket).toHaveBeenCalledWith("u1", "e1", T, "Hola de nuevo", [`zilonix-soporte/e1/${T}-0`]);
  });
});
