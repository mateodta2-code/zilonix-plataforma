import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CuentaMlNoEncontradaError, obtenerAccessTokenVigente } from "@/lib/ml/cuentas";
import { pedirBinarioMl } from "@/lib/ml/cliente";
import { GET } from "./route";

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "emp-1" }) }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "emp-1" }]) }));
vi.mock("@/lib/permisos", () => ({
  requierePermiso: vi.fn(async () => undefined),
  SinPermisoError: class SinPermisoError extends Error {},
}));
// Mock completo: el módulo real abre la conexión a la base al importarse.
vi.mock("@/lib/ml/cuentas", () => ({
  CuentaMlNoEncontradaError: class CuentaMlNoEncontradaError extends Error {},
  obtenerAccessTokenVigente: vi.fn(async () => "token-falso"),
}));
vi.mock("@/lib/ml/cliente", async (original) => ({
  ...(await original<typeof import("@/lib/ml/cliente")>()),
  pedirBinarioMl: vi.fn(),
}));

const CUENTA = "11111111-1111-4111-8111-111111111111";
const req = new NextRequest("https://x.test/api/ml/reclamos/x");
const llamar = (cuentaId: string, reclamoId: string, archivo: string) => GET(req, { params: { cuentaId, reclamoId, archivo } });

describe("GET adjuntos de un reclamo (Reclamos-A)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("cuenta que no es de la empresa → 404 y nunca llama a ML", async () => {
    vi.mocked(obtenerAccessTokenVigente).mockRejectedValueOnce(new CuentaMlNoEncontradaError());
    const res = await llamar(CUENTA, "5619539113", "foto.png");
    expect(res.status).toBe(404);
    expect(pedirBinarioMl).not.toHaveBeenCalled();
  });

  it("cuentaId que no es uuid → 404 sin tocar la base", async () => {
    const res = await llamar("../x", "5619539113", "foto.png");
    expect(res.status).toBe(404);
    expect(obtenerAccessTokenVigente).not.toHaveBeenCalled();
  });

  it.each(["../secreto", "a/b.png", ".oculto", "a..b.png", "a b.png"])("nombre de archivo inválido %s → 400", async (archivo) => {
    const res = await llamar(CUENTA, "5619539113", archivo);
    expect(res.status).toBe(400);
    expect(pedirBinarioMl).not.toHaveBeenCalled();
  });

  it("id de reclamo inválido → 400", async () => {
    expect((await llamar(CUENTA, "12ab", "foto.png")).status).toBe(400);
  });

  it("adjunto de otro reclamo (ML responde 404) → 404", async () => {
    vi.mocked(pedirBinarioMl).mockResolvedValueOnce({ ok: false, status: 404, textoCrudo: "" });
    expect((await llamar(CUENTA, "5619539113", "foto.png")).status).toBe(404);
  });

  it("adjunto válido → bytes, tipo por firma y caché privada", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]).buffer;
    vi.mocked(pedirBinarioMl).mockResolvedValueOnce({ ok: true, data: png });
    const res = await llamar(CUENTA, "5619539113", "foto.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toContain("private");
    expect(pedirBinarioMl).toHaveBeenCalledWith("/post-purchase/v1/claims/5619539113/attachments/foto.png/download", "token-falso");
  });
});
