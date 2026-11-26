import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "e1" }) }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "e1" }]) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { SinPermisoError, requierePermiso: vi.fn(async () => ({})) };
});
vi.mock("@/lib/cloudinary", () => ({
  descargarFotoPrivada: vi.fn(async () => ({ bytes: new ArrayBuffer(3), contentType: "image/jpeg" })),
}));

import { descargarFotoPrivada } from "@/lib/cloudinary";
import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerOCrearUsuarioActual } from "@/lib/usuarios";
import { responderFotoDeEmpresa } from "./responderFoto";

const ID = "11111111-2222-4333-8444-555555555555";

// Domi-3/Domi-4 — la foto privada solo sale para alguien de la empresa con ventas.consultar.
describe("responderFotoDeEmpresa", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin sesión: 401 y no busca nada", async () => {
    vi.mocked(obtenerOCrearUsuarioActual).mockResolvedValueOnce(null as never);
    const buscar = vi.fn();
    expect((await responderFotoDeEmpresa(ID, buscar, "t")).status).toBe(401);
    expect(buscar).not.toHaveBeenCalled();
  });

  it("sin permiso de ventas: 403 y no busca nada", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("ventas", "consultar"));
    const buscar = vi.fn();
    expect((await responderFotoDeEmpresa(ID, buscar, "t")).status).toBe(403);
    expect(requierePermiso).toHaveBeenCalledWith("u1", "e1", "ventas", "consultar");
    expect(buscar).not.toHaveBeenCalled();
  });

  it("id inválido o foto que no es de la empresa: 404 sin descargar", async () => {
    expect((await responderFotoDeEmpresa("no-uuid", vi.fn(), "t")).status).toBe(404);
    const buscar = vi.fn(async () => null);
    expect((await responderFotoDeEmpresa(ID, buscar, "t")).status).toBe(404);
    expect(buscar).toHaveBeenCalledWith("e1", ID);
    expect(descargarFotoPrivada).not.toHaveBeenCalled();
  });

  it("de la empresa: la imagen, sin caché compartida", async () => {
    const r = await responderFotoDeEmpresa(ID, vi.fn(async () => "zilonix-entregas/e1/x"), "t");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("image/jpeg");
    expect(r.headers.get("cache-control")).toBe("private, no-store");
    expect(descargarFotoPrivada).toHaveBeenCalledWith("zilonix-entregas/e1/x");
  });
});
