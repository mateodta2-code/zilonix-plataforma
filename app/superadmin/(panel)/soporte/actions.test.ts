import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/superadmin", () => ({ requiereSesionSuperadmin: vi.fn(async () => ({ usuarioId: "sa1" })) }));
vi.mock("@/lib/cloudinary", () => ({ CloudinaryNoConfiguradoError: class extends Error {} }));
vi.mock("@/lib/soporte/subirImagenes", () => ({ subirImagenesTicket: vi.fn(async (e: string, t: string, b: Uint8Array[]) => b.map((_, i) => `zilonix-soporte/${e}/${t}-${i}`)) }));
vi.mock("@/lib/soporte/superadmin", () => ({
  obtenerTicketParaAtender: vi.fn(async () => ({ empresaId: "e1" })),
  responderComoSuperadmin: vi.fn(async () => {}),
  cambiarEstadoTicket: vi.fn(async () => {}),
}));

import { subirImagenesTicket } from "@/lib/soporte/subirImagenes";
import { obtenerTicketParaAtender, responderComoSuperadmin } from "@/lib/soporte/superadmin";
import { responderTicketSuperadminAction } from "./actions";

const T = "22222222-2222-4222-8222-222222222222";
const conImagenes = (...bytes: number[][]) => {
  const d = new FormData();
  bytes.forEach((b, i) => d.append("imagen", new File([new Uint8Array(b)], `c${i}.jpg`, { type: "image/jpeg" })));
  return d;
};
const JPEG = [0xff, 0xd8, 0xff, 0xe0];

// Capturas del superadmin al responder un ticket (25-nov).
describe("responderTicketSuperadminAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sube las capturas a la carpeta de la empresa DEL TICKET y responde con sus ids", async () => {
    await expect(responderTicketSuperadminAction(T, "Mira esta captura", conImagenes(JPEG))).resolves.toEqual({ ok: true });
    expect(subirImagenesTicket).toHaveBeenCalledWith("e1", T, expect.any(Array));
    expect(responderComoSuperadmin).toHaveBeenCalledWith("sa1", T, "Mira esta captura", [`zilonix-soporte/e1/${T}-0`]);
  });

  it("texto o imagen inválida, o ticket que no existe: no sube nada", async () => {
    await expect(responderTicketSuperadminAction(T, "", conImagenes(JPEG))).resolves.toMatchObject({ ok: false });
    await expect(responderTicketSuperadminAction(T, "Hola", conImagenes([0x89, 0x50]))).resolves.toMatchObject({ ok: false });
    vi.mocked(obtenerTicketParaAtender).mockResolvedValueOnce(null);
    await expect(responderTicketSuperadminAction(T, "Hola", conImagenes(JPEG))).resolves.toMatchObject({ ok: false });
    expect(subirImagenesTicket).not.toHaveBeenCalled();
    expect(responderComoSuperadmin).not.toHaveBeenCalled();
  });

  it("sin imágenes responde como antes", async () => {
    await expect(responderTicketSuperadminAction(T, "Hola")).resolves.toEqual({ ok: true });
    expect(subirImagenesTicket).not.toHaveBeenCalled();
    expect(responderComoSuperadmin).toHaveBeenCalledWith("sa1", T, "Hola", []);
  });
});
