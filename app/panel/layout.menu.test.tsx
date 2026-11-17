import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
});

let permisos: { modulo: string; accion: string }[] = [];

vi.mock("next/navigation", () => ({ usePathname: () => "/panel", useRouter: () => ({ push: () => {}, refresh: () => {} }) }));
vi.mock("@/components/marco/BotonCerrarSesion", () => ({ BotonCerrarSesion: () => null }));
vi.mock("@/lib/panel-contexto", () => ({
  obtenerContextoPanel: async () => ({
    usuario: { nombre: "U" },
    propias: [],
    activa: { id: "e", nombre: "E", nit: "1" },
    permisos,
    rolNombre: "Gerente",
    suspendida: false,
    clerkUser: null,
  }),
}));

async function menuHtml() {
  const Layout = (await import("./layout")).default;
  return renderToStaticMarkup(await Layout({ children: <p>contenido</p> }));
}

// Módulo Optimización — mismo permiso que Investigación y Publicar
// ("inventario","consultar") y posición fija entre los dos.
describe("menú de /panel — Optimización", () => {
  it("aparece entre «Investigación» y «Publicar» con inventario/consultar", async () => {
    permisos = [{ modulo: "inventario", accion: "consultar" }];
    const html = await menuHtml();
    const i = html.indexOf("Investigación");
    const o = html.indexOf("Optimización");
    const p = html.indexOf("Publicar");
    expect(i).toBeGreaterThan(-1);
    expect(o).toBeGreaterThan(i);
    expect(p).toBeGreaterThan(o);
    expect(html).toContain('href="/panel/optimizacion"');
  });

  it("sin inventario/consultar no se ve", async () => {
    permisos = [{ modulo: "ventas", accion: "consultar" }];
    const html = await menuHtml();
    expect(html).not.toContain("Optimización");
    expect(html).not.toContain("/panel/optimizacion");
  });
});
