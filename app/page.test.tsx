import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Tarea fix-login-directo-panel — "/" nunca vuelve a mostrar los
// botones "Ver mi cuenta"/"Ir al panel" para alguien con sesión: el
// destino es un redirect de servidor directo a /panel (sin parpadeo).
// vi.hoisted(): vi.mock() se adelanta al tope del archivo — sin esto
// las referencias a estos mocks dentro de los factory de abajo revientan
// con "Cannot access ... before initialization" (mismo criterio que
// app/panel/pedidos/[id]/page.test.tsx).
const { redirectMock, obtenerOCrearUsuarioActualMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    // Mismo comportamiento real de next/navigation: redirect() nunca
    // "devuelve", corta la ejecución lanzando.
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  obtenerOCrearUsuarioActualMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: redirectMock }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: obtenerOCrearUsuarioActualMock }));
vi.mock("@clerk/nextjs", () => ({ SignedOut: ({ children }: { children: React.ReactNode }) => children }));

import HomePage from "./page";

describe("Portada (/) — tarea fix-login-directo-panel", () => {
  afterEach(() => {
    redirectMock.mockClear();
    obtenerOCrearUsuarioActualMock.mockClear();
  });

  it("con sesión: redirige a /panel antes de pintar nada (sin parpadeo)", async () => {
    obtenerOCrearUsuarioActualMock.mockResolvedValue({ id: "usuario-1" });
    await expect(HomePage({ searchParams: {} })).rejects.toThrow("NEXT_REDIRECT:/panel");
    expect(redirectMock).toHaveBeenCalledWith("/panel");
  });

  it("sin sesión: sigue mostrando la portada pública, sin redirigir", async () => {
    obtenerOCrearUsuarioActualMock.mockResolvedValue(null);
    const html = renderToStaticMarkup(await HomePage({ searchParams: {} }));
    expect(redirectMock).not.toHaveBeenCalled();
    expect(html).toContain("Iniciar sesión");
    expect(html).toContain("Crear cuenta");
  });

  it("sin sesión, con ?salida=cuenta-borrada: muestra el aviso de salida", async () => {
    obtenerOCrearUsuarioActualMock.mockResolvedValue(null);
    const html = renderToStaticMarkup(await HomePage({ searchParams: { salida: "cuenta-borrada" } }));
    expect(html).toContain("Tu cuenta quedó anonimizada y tu acceso fue borrado.");
  });
});
