import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
});

const estado: { usuario: { id: string } | null; yaTiene: boolean } = { usuario: null, yaTiene: false };
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: async () => estado.usuario }));
vi.mock("@/lib/bodega/autorregistro", () => ({ yaCreoBodegaAutorregistrada: async () => estado.yaTiene, NOMBRE_SEDE_POR_DEFECTO: "Sede principal" }));
vi.mock("@/lib/bodega/contexto", () => ({ RUTA_LOGIN: { bodega: "/bodega/iniciar-sesion", domiciliario: "/domiciliario/iniciar-sesion" } }));
vi.mock("./actions", () => ({ crearBodegaAction: async () => {} }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT:${destino}`);
  },
}));

describe("/bodega/crear", () => {
  beforeEach(() => {
    estado.usuario = null;
    estado.yaTiene = false;
  });

  it("sin sesión redirige al login de la bodega", async () => {
    const Pagina = (await import("./page")).default;
    await expect(Pagina({ searchParams: {} })).rejects.toThrow("REDIRECT:/bodega/iniciar-sesion");
  });

  it("si ya creó su bodega redirige a /bodega", async () => {
    estado.usuario = { id: "u" };
    estado.yaTiene = true;
    const Pagina = (await import("./page")).default;
    await expect(Pagina({ searchParams: {} })).rejects.toThrow("REDIRECT:/bodega");
  });
});
