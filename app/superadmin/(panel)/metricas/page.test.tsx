import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
  process.env.DATABASE_URL_SUPERADMIN ||= "postgres://x:x@localhost:5432/x";
});

const redirigir = vi.hoisted(() => vi.fn(() => { throw new Error("NEXT_REDIRECT"); }));
const listar = vi.hoisted(() => vi.fn());
vi.mock("@/lib/superadmin", async (orig) => ({
  ...(await orig<typeof import("@/lib/superadmin")>()),
  requiereSesionSuperadmin: async () => { redirigir(); },
  listarEmpresasConConteo: listar,
}));
vi.mock("@/lib/superadmin-bodegas", () => ({ listarBodegas: vi.fn(async () => []) }));

describe("/superadmin/metricas sin sesión", () => {
  beforeEach(() => vi.clearAllMocks());
  it("redirige al login aparte y no consulta ningún dato", async () => {
    const Pagina = (await import("./page")).default;
    await expect(Pagina()).rejects.toThrow("NEXT_REDIRECT");
    expect(redirigir).toHaveBeenCalled();
    expect(listar).not.toHaveBeenCalled();
  });
});
