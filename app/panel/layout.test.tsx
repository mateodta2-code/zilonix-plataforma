import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// postgres-js conecta recién en la primera consulta: una URL de relleno
// alcanza para importar el layout sin base real.
vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
});

vi.mock("@/lib/anuncios", () => ({ anunciosVigentes: vi.fn(async () => []) }));
vi.mock("@/lib/panel-contexto", () => ({
  obtenerContextoPanel: async () => ({
    usuario: { nombre: "U" },
    propias: [],
    activa: { id: "e", nombre: "E", nit: "1" },
    permisos: [],
    rolNombre: "Dueño",
    suspendida: true,
    clerkUser: null,
  }),
}));

// PR B — una empresa suspendida no entra a /panel: solo ve el aviso y
// las páginas hijas ni se pintan.
describe("layout de /panel con empresa suspendida", () => {
  it("muestra el aviso y no renderiza ningún módulo", async () => {
    const Layout = (await import("./layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>MODULO-SECRETO</p> }));
    expect(html).toContain("Tu cuenta está suspendida. Escríbenos a soporte.");
    expect(html).not.toContain("MODULO-SECRETO");
  });
});
