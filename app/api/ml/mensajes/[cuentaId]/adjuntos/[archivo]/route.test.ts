import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listarCuentasConectadas, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { pedirBinarioMl } from "@/lib/ml/cliente";
import { GET } from "./route";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "emp-1" }) }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "emp-1" }]) }));
vi.mock("@/lib/permisos", () => ({ requierePermiso: vi.fn(async () => undefined), SinPermisoError: class SinPermisoError extends Error {} }));
vi.mock("@/lib/ml/cuentas", () => ({
  CuentaMlNoEncontradaError: class CuentaMlNoEncontradaError extends Error {},
  listarCuentasConectadas: vi.fn(),
  obtenerAccessTokenVigente: vi.fn(async () => "token-falso"),
}));
vi.mock("@/lib/ml/cliente", async (original) => ({ ...(await original<typeof import("@/lib/ml/cliente")>()), pedirBinarioMl: vi.fn() }));

const CUENTA = "11111111-1111-4111-8111-111111111111";
const req = new NextRequest("https://x.test/api/ml/mensajes/x");
const llamar = (cuentaId: string, archivo: string) => GET(req, { params: { cuentaId, archivo } });

describe("GET adjuntos de un mensaje de venta (Posventa-Mensajes)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listarCuentasConectadas).mockResolvedValue([{ id: CUENTA, siteId: "MCO" }] as never);
  });

  it("cuenta que no es de la empresa → 404 y nunca llama a ML", async () => {
    vi.mocked(listarCuentasConectadas).mockResolvedValue([]);
    expect((await llamar(CUENTA, "foto.png")).status).toBe(404);
    expect(pedirBinarioMl).not.toHaveBeenCalled();
    expect(obtenerAccessTokenVigente).not.toHaveBeenCalled();
  });

  it.each(["../secreto", "a/b.png", ".oculto", "a..b.png"])("nombre inválido %s → 400", async (archivo) => {
    expect((await llamar(CUENTA, archivo)).status).toBe(400);
    expect(pedirBinarioMl).not.toHaveBeenCalled();
  });

  it("adjunto válido → bytes con la ruta documentada y caché privada", async () => {
    vi.mocked(pedirBinarioMl).mockResolvedValueOnce({ ok: true, data: new ArrayBuffer(4), tipo: "image/png" });
    const res = await llamar(CUENTA, "foto.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(pedirBinarioMl).toHaveBeenCalledWith("/marketplace/messages/attachments/foto.png", "token-falso", "?tag=post_sale&site_id=MCO");
  });
});
