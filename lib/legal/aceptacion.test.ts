import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const updateUserMetadata = vi.fn();
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { getUser, updateUserMetadata } }),
}));

import { VERSION_TERMINOS, registrarAceptacionTerminos, validarAceptacionTerminos } from "./aceptacion";

function formulario(valor?: string) {
  const f = new FormData();
  if (valor !== undefined) f.set("acepta_terminos", valor);
  return f;
}

describe("validarAceptacionTerminos", () => {
  it("acepta solo 'si'", () => {
    expect(validarAceptacionTerminos(formulario("si"))).toBe(true);
    expect(validarAceptacionTerminos(formulario())).toBe(false);
    expect(validarAceptacionTerminos(formulario("on"))).toBe(false);
    expect(validarAceptacionTerminos(formulario(""))).toBe(false);
  });
});

describe("registrarAceptacionTerminos", () => {
  beforeEach(() => {
    getUser.mockReset();
    updateUserMetadata.mockReset();
  });

  it("guarda versión y fecha ISO sin perder la metadata existente", async () => {
    getUser.mockResolvedValue({ privateMetadata: { otra: "cosa" } });
    await registrarAceptacionTerminos("user_1");
    const [id, cuerpo] = updateUserMetadata.mock.calls[0];
    expect(id).toBe("user_1");
    expect(cuerpo.privateMetadata.otra).toBe("cosa");
    expect(cuerpo.privateMetadata.terminosAceptados.version).toBe(VERSION_TERMINOS);
    const fecha = cuerpo.privateMetadata.terminosAceptados.fecha;
    expect(new Date(fecha).toISOString()).toBe(fecha);
  });
});
