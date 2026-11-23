import { beforeEach, describe, expect, it, vi } from "vitest";

const obtenerUsuario = vi.fn();
const crearEmpresa = vi.fn();
const registrar = vi.fn();

vi.mock("next/navigation", () => ({
  redirect: (ruta: string) => {
    throw new Error(`REDIRECT:${ruta}`);
  },
}));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: () => obtenerUsuario() }));
vi.mock("./actions", () => ({ crearEmpresaAction: (f: FormData) => crearEmpresa(f) }));
vi.mock("@/lib/legal/aceptacion", async (original) => ({
  ...(await original<typeof import("@/lib/legal/aceptacion")>()),
  registrarAceptacionTerminos: (id: string) => registrar(id),
}));

import { crearEmpresaConTerminosAction } from "./acciones-terminos";

function formulario(acepta?: string) {
  const f = new FormData();
  f.set("nombre", "Mi empresa");
  f.set("nit", "900123456");
  if (acepta !== undefined) f.set("acepta_terminos", acepta);
  return f;
}

describe("crearEmpresaConTerminosAction", () => {
  beforeEach(() => {
    obtenerUsuario.mockReset().mockResolvedValue({ id: "u1", clerkUserId: "user_1" });
    crearEmpresa.mockReset();
    registrar.mockReset();
  });

  it("sin casilla rechaza y no crea la empresa ni registra nada", async () => {
    await expect(crearEmpresaConTerminosAction(formulario())).rejects.toThrow(
      "Debes aceptar los Términos y la Política de privacidad para continuar."
    );
    expect(crearEmpresa).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled();
  });

  it("sin sesión manda a /sign-in", async () => {
    obtenerUsuario.mockResolvedValue(null);
    await expect(crearEmpresaConTerminosAction(formulario("si"))).rejects.toThrow("REDIRECT:/sign-in");
    expect(crearEmpresa).not.toHaveBeenCalled();
  });

  it("con casilla registra la aceptación y crea la empresa", async () => {
    const f = formulario("si");
    await crearEmpresaConTerminosAction(f);
    expect(registrar).toHaveBeenCalledWith("user_1");
    expect(crearEmpresa).toHaveBeenCalledWith(f);
  });
});
