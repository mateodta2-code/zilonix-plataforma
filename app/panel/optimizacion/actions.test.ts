import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
});

const CUENTA = "11111111-1111-4111-8111-111111111111";
const requierePermiso = vi.fn();
const cambiarEstadoItemMl = vi.fn();

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => ({ value: "e1" }) }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => ({ id: "u1" }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: async () => [{ id: "e1" }] }));
vi.mock("@/lib/permisos", () => ({
  requierePermiso: (...args: unknown[]) => requierePermiso(...args),
  SinPermisoError: class SinPermisoError extends Error {},
}));
vi.mock("@/lib/ml/estado-item", () => ({ cambiarEstadoItemMl: (...args: unknown[]) => cambiarEstadoItemMl(...args) }));
vi.mock("@/db/empresa-context", () => ({ dbComoEmpresa: async (_e: string, fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: async () => {} }));

describe("cambiarEstadoPublicacionAction", () => {
  beforeEach(() => {
    requierePermiso.mockReset().mockResolvedValue({});
    cambiarEstadoItemMl.mockReset().mockResolvedValue({ status: "paused" });
  });

  it("exige inventario/modificar antes de tocar Mercado Libre", async () => {
    const { cambiarEstadoPublicacionAction } = await import("./actions");
    await cambiarEstadoPublicacionAction({ cuentaId: CUENTA, itemId: "ABC123", activar: false });
    expect(requierePermiso).toHaveBeenCalledWith("u1", "e1", "inventario", "modificar");
  });

  it("sin el permiso no llama a Mercado Libre", async () => {
    const { SinPermisoError } = await import("@/lib/permisos");
    requierePermiso.mockRejectedValue(new SinPermisoError("inventario", "modificar"));
    const { cambiarEstadoPublicacionAction } = await import("./actions");
    const r = await cambiarEstadoPublicacionAction({ cuentaId: CUENTA, itemId: "ABC123", activar: false });
    expect(r.ok).toBe(false);
    expect(cambiarEstadoItemMl).not.toHaveBeenCalled();
  });

  it("ids inválidos nunca llegan a Mercado Libre", async () => {
    const { cambiarEstadoPublicacionAction } = await import("./actions");
    const r = await cambiarEstadoPublicacionAction({ cuentaId: "no-uuid", itemId: "ABC123/../x", activar: true });
    expect(r.ok).toBe(false);
    expect(cambiarEstadoItemMl).not.toHaveBeenCalled();
  });

  it("pausa y devuelve el estado nuevo", async () => {
    const { cambiarEstadoPublicacionAction } = await import("./actions");
    const r = await cambiarEstadoPublicacionAction({ cuentaId: CUENTA, itemId: "ABC123", activar: false });
    expect(r).toEqual({ ok: true, status: "paused" });
    expect(cambiarEstadoItemMl).toHaveBeenCalledWith("e1", CUENTA, "ABC123", false);
  });

  it("muestra tal cual el mensaje amigable de 'en revisión'", async () => {
    cambiarEstadoItemMl.mockRejectedValue(new Error("Mercado Libre todavía está revisando esta publicación (recién creada) y no deja apagarla."));
    const { cambiarEstadoPublicacionAction } = await import("./actions");
    const r = await cambiarEstadoPublicacionAction({ cuentaId: CUENTA, itemId: "ABC123", activar: false });
    expect(r).toEqual({ ok: false, mensaje: "Mercado Libre todavía está revisando esta publicación (recién creada) y no deja apagarla." });
  });
});
