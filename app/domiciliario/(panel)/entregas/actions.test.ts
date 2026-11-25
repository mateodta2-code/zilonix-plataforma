import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/bodega/contexto", () => ({
  accesoBodega: vi.fn(async () => ({ usuario: { id: "u1" }, decision: { ok: true, membresia: { bodegaId: "b1" } } })),
}));
vi.mock("@/lib/cloudinary", () => ({
  CloudinaryNoConfiguradoError: class extends Error {},
  subirFotoPrivada: vi.fn(async () => ({ publicId: "zilonix-entregas/e1/ent" })),
}));
vi.mock("@/lib/entregas/entregas", () => ({
  EntregaInvalidaError: class extends Error {},
  miEntregaAbierta: vi.fn(async () => ({ empresaId: "e1" })),
  cambiarEstadoMiEntrega: vi.fn(async () => {}),
}));

import { accesoBodega } from "@/lib/bodega/contexto";
import { subirFotoPrivada } from "@/lib/cloudinary";
import { cambiarEstadoMiEntrega, miEntregaAbierta } from "@/lib/entregas/entregas";
import { marcarEntregadoAction } from "./actions";

const ID = "11111111-2222-4333-8444-555555555555";
const conFoto = (bytes: number[]) => {
  const d = new FormData();
  d.append("foto", new File([new Uint8Array(bytes)], "entrega.jpg", { type: "image/jpeg" }));
  return d;
};

// Domi-3 — «Entregado» con foto, desde el celular del domiciliario.
describe("marcarEntregadoAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin foto o con un archivo que no es JPEG: no sube nada ni cambia la entrega", async () => {
    await expect(marcarEntregadoAction(ID, new FormData())).resolves.toMatchObject({ ok: false });
    await expect(marcarEntregadoAction(ID, conFoto([0x89, 0x50, 0x4e, 0x47]))).resolves.toMatchObject({ ok: false });
    expect(subirFotoPrivada).not.toHaveBeenCalled();
    expect(cambiarEstadoMiEntrega).not.toHaveBeenCalled();
  });

  it("con foto: confirma que la entrega es suya, la sube privada en la carpeta de la empresa y cierra con su id", async () => {
    await expect(marcarEntregadoAction(ID, conFoto([0xff, 0xd8, 0xff, 0xe0]))).resolves.toEqual({ ok: true });
    expect(miEntregaAbierta).toHaveBeenCalledWith("b1", "u1", ID);
    expect(vi.mocked(subirFotoPrivada).mock.calls[0].slice(1)).toEqual(["zilonix-entregas/e1", ID]);
    expect(cambiarEstadoMiEntrega).toHaveBeenCalledWith("b1", "u1", ID, "entregada", undefined, "zilonix-entregas/e1/ent");
    expect(vi.mocked(miEntregaAbierta).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(subirFotoPrivada).mock.invocationCallOrder[0]);
  });

  it("si la entrega no es suya, no sube la foto", async () => {
    vi.mocked(miEntregaAbierta).mockRejectedValueOnce(new Error("ajena"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(marcarEntregadoAction(ID, conFoto([0xff, 0xd8, 0xff, 0xe0]))).resolves.toMatchObject({ ok: false });
    expect(subirFotoPrivada).not.toHaveBeenCalled();
  });

  it("sin sesión de domiciliario: no hace nada", async () => {
    vi.mocked(accesoBodega).mockResolvedValueOnce({ usuario: { id: "u1" }, decision: { ok: false } } as never);
    await expect(marcarEntregadoAction(ID, conFoto([0xff, 0xd8, 0xff]))).resolves.toMatchObject({ ok: false });
    expect(miEntregaAbierta).not.toHaveBeenCalled();
  });
});
