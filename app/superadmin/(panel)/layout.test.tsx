import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { gruposSuperadmin } from "@/components/marco/menuSuperadmin";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
  process.env.DATABASE_URL_SUPERADMIN ||= "postgres://x:x@localhost:5432/x";
});

vi.mock("@/lib/superadmin", () => ({ requiereSesionSuperadmin: async () => ({ usuarioId: "u", clerkUserId: "c" }) }));
vi.mock("@clerk/nextjs/server", () => ({ currentUser: async () => ({ firstName: "Ana", lastName: "Prueba", imageUrl: null }) }));
vi.mock("../actions", () => ({ cerrarSesionSuperadminAction: async () => {} }));

describe("layout del panel superadmin", () => {
  it("usa el marco del vendedor: logo, etiqueta de panel, secciones y cierre de sesión propio", async () => {
    const Layout = (await import("./layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>CONTENIDO</p> }));
    expect(html).toContain("CONTENIDO");
    expect(html).toContain("zilonix-seller-logo.svg");
    expect(html).toContain("Superadmin");
    expect(html).toContain("Administración");
    expect(html).toContain("Equipo superadmin");
    expect(html).toContain("Ana Prueba");
    expect(html).toContain("Cerrar sesión");
    expect(html).toContain("Mi cuenta");
    expect(html).not.toContain('name="empresaId"'); // sin selector de empresa
  });
});

describe("menú del superadmin", () => {
  const items = gruposSuperadmin().flatMap((g) => g.items);
  it("todo apunta a /superadmin", () => {
    for (const i of items) expect(i.href.startsWith("/superadmin")).toBe(true);
  });
  it("no muestra ítems del vendedor", () => {
    const etiquetas = items.map((i) => i.etiqueta);
    for (const prohibido of ["Pedidos", "Despachos", "Productos", "Investigación", "Publicar", "Promociones", "Finanzas", "Publicidad", "Personas"]) {
      expect(etiquetas).not.toContain(prohibido);
    }
  });
  it("Soporte queda habilitado y apunta a /superadmin/soporte", () => {
    const i = items.find((x) => x.etiqueta === "Soporte");
    expect(i?.href).toBe("/superadmin/soporte");
    expect(i?.deshabilitada).toBeFalsy();
    expect(i?.titulo).not.toBe("Próximamente");
  });
});

describe("menú: Métricas", () => {
  it("queda habilitada y apunta a /superadmin/metricas", () => {
    const i = gruposSuperadmin().flatMap((g) => g.items).find((x) => x.etiqueta === "Métricas");
    expect(i?.href).toBe("/superadmin/metricas");
    expect(i?.deshabilitada).toBeFalsy();
  });
});
