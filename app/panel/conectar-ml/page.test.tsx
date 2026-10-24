import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

// Issue #151 — bug real: esta pantalla mostraba `searchParams.error` tal
// cual, y /api/ml/callback le pasaba ahí el error.message crudo de
// cualquier falla (texto de Mercado Libre o de Postgres). Ahora el
// Route Handler solo manda uno de 5 códigos fijos, y esta página los
// traduce desde un mapa cerrado — esta prueba confirma, en el lugar
// exacto donde se renderiza, que un código conocido muestra su mensaje
// y que CUALQUIER otra cosa (texto arbitrario, incluido algo con
// marcado) nunca se renderiza tal cual, siempre cae en el genérico.
const { obtenerOCrearUsuarioActualMock, listarEmpresasDeUsuarioMock, requierePermisoMock, listarCuentasConectadasMock, cookiesGetMock } = vi.hoisted(
  () => ({
    obtenerOCrearUsuarioActualMock: vi.fn(),
    listarEmpresasDeUsuarioMock: vi.fn(),
    requierePermisoMock: vi.fn(),
    listarCuentasConectadasMock: vi.fn(),
    cookiesGetMock: vi.fn(() => ({ value: "empresa-1" })),
  })
);

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: cookiesGetMock }) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: obtenerOCrearUsuarioActualMock }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: listarEmpresasDeUsuarioMock }));
vi.mock("@/lib/membresias", () => ({ obtenerMiMembresia: vi.fn() }));
vi.mock("@/lib/permisos", () => ({ requierePermiso: requierePermisoMock, SinPermisoError: class SinPermisoErrorFalso extends Error {} }));
vi.mock("@/lib/ml/cuentas", () => ({ listarCuentasConectadas: listarCuentasConectadasMock }));
vi.mock("@/lib/ml/importacion", () => ({ obtenerUltimaImportacion: vi.fn() }));

import ConectarMlPage from "./page";

async function renderConError(error?: string): Promise<string> {
  obtenerOCrearUsuarioActualMock.mockResolvedValue({ id: "usuario-1" });
  listarEmpresasDeUsuarioMock.mockResolvedValue([{ id: "empresa-1", nombre: "Empresa Test", nit: "123" }]);
  requierePermisoMock.mockResolvedValue({ rolNombre: "Dueño", permisos: [] });
  listarCuentasConectadasMock.mockResolvedValue([]);
  const resultado = await ConectarMlPage({ searchParams: { error } });
  return renderToStaticMarkup(resultado as never);
}

describe("ConectarMlPage — mapa cerrado de ?error (issue #151)", () => {
  it('código fijo conocido ("cuenta_en_otra_empresa"): muestra su mensaje en español', async () => {
    const html = await renderConError("cuenta_en_otra_empresa");
    expect(html).toContain("ya está conectada a otra empresa");
  });

  it("texto arbitrario (incluido algo con marcado) en ?error: nunca se renderiza tal cual, cae en el mensaje genérico", async () => {
    const textoArbitrario = "<script>alert(1)</script> cualquier cosa que alguien ponga en la URL";
    const html = await renderConError(textoArbitrario);
    expect(html).not.toContain(textoArbitrario);
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("No se pudo conectar la cuenta");
  });

  it("sin ?error: no muestra ningún aviso de error", async () => {
    const html = await renderConError(undefined);
    expect(html).not.toContain("No se pudo conectar la cuenta");
  });
});
