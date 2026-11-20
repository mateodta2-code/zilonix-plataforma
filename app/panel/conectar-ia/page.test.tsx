import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/headers", () => ({ cookies: () => ({ get: () => undefined }) }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasDeUsuario: vi.fn(async () => [{ id: "e1" }]) }));
vi.mock("@/lib/usuarios", () => ({ obtenerOCrearUsuarioActual: vi.fn(async () => ({ id: "u1" })) }));
vi.mock("@/lib/membresias", () => ({ obtenerMiMembresia: vi.fn(async () => ({ rolNombre: "Rol", permisos: [] })) }));
vi.mock("@/lib/permisos", () => {
  class SinPermisoError extends Error {}
  return { requierePermiso: vi.fn(async () => ({})), SinPermisoError };
});
vi.mock("@/lib/ia/conexion", () => ({
  listarConexionesIA: vi.fn(async () => [
    { id: "i1", nombre: "Claude", proveedor: "anthropic", baseUrl: null, modelo: "m", esPrincipal: true, modulos: [], actualizadoTs: new Date() },
  ]),
}));

import { requierePermiso, SinPermisoError } from "@/lib/permisos";
import { obtenerMiMembresia } from "@/lib/membresias";
import ConectarIaPage from "./page";
import ConfiguracionPage from "../configuracion/page";

const html = async (p: () => Promise<React.ReactElement>) => renderToStaticMarkup(await p());

describe("página Conectar IA", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sin permiso -> SinAcceso, sin conexiones", async () => {
    vi.mocked(requierePermiso).mockRejectedValueOnce(new SinPermisoError("configuracion", "consultar"));
    const h = await html(ConectarIaPage);
    expect(h).toContain("no tiene acceso");
    expect(h).not.toContain("Claude");
  });

  it("sin modificar no muestra formulario ni botones; con texto sin voseo y sin llaves", async () => {
    vi.mocked(obtenerMiMembresia).mockResolvedValue({ rolNombre: "R", permisos: [{ modulo: "configuracion", accion: "consultar" }] } as never);
    const h = await html(ConectarIaPage);
    expect(h).toContain("1 de 5 IA conectadas");
    expect(h).not.toContain("Agregar IA");
    expect(h).not.toContain("Probar conexión");
    expect(h).not.toMatch(/apiKey|api_key_cifrada|sk-/);
    expect(h).not.toMatch(/\b(Conectá|tenés|Elegí)\b/);
    expect(h).toContain("Zilonix no pone IA");
  });

  it("con modificar muestra los botones", async () => {
    vi.mocked(obtenerMiMembresia).mockResolvedValue({
      rolNombre: "R",
      permisos: [{ modulo: "configuracion", accion: "consultar" }, { modulo: "configuracion", accion: "modificar" }],
    } as never);
    const h = await html(ConectarIaPage);
    expect(h).toContain("Agregar IA");
    expect(h).toContain("Probar conexión");
  });

  it("Configuración muestra el enlace y ya no el formulario", async () => {
    const h = await html(ConfiguracionPage);
    expect(h).toContain('href="/panel/conectar-ia"');
    expect(h).toContain("Administración → Conectar IA");
    expect(h).not.toContain("API key");
  });
});
