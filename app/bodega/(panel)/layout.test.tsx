import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { gruposBodega, gruposDomiciliario } from "@/components/marco/menuBodega";
import type { DecisionAcceso } from "@/lib/bodega/acceso";

vi.hoisted(() => {
  process.env.DATABASE_URL_APP ||= "postgres://x:x@localhost:5432/x";
});

const estado: { decision: DecisionAcceso } = { decision: { ok: false, motivo: "sin-membresia" } };
vi.mock("@/lib/bodega/contexto", () => ({
  accesoBodega: async () => ({ usuario: { id: "u", nombre: "Ana Prueba" }, clerkUser: null, decision: estado.decision }),
}));
// BotonCerrarSesion (Clerk) no se necesita para pintar el marco.
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut: async () => {} }) }));

const membresia = (rol: "admin_bodega" | "operario" | "domiciliario") => ({
  bodegaId: "b", bodegaNombre: "Bodega Uno", bodegaNit: null, bodegaEstado: "activa" as const, rol, activo: true,
});

describe("marco de bodega y domiciliario (mismo MarcoApp del vendedor)", () => {
  beforeEach(() => {
    estado.decision = { ok: true, membresia: membresia("admin_bodega") };
  });

  it("bodega: logo, etiqueta del panel, grupo ADMINISTRACIÓN para el admin, Mi cuenta y sin ítems del vendedor", async () => {
    const Layout = (await import("./layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>CONTENIDO</p> }));
    expect(html).toContain("CONTENIDO");
    expect(html).toContain("zilonix-seller-logo.svg");
    expect(html).toContain(">Bodega<");
    expect(html).toContain("Administración");
    expect(html).toContain("Invitar persona");
    expect(html).toContain("Mi cuenta");
    expect(html).toContain("Ana Prueba");
    expect(html).not.toContain("Pedidos");
    expect(html).not.toContain("Finanzas");
  });

  it("bodega: el operario no ve ADMINISTRACIÓN", async () => {
    estado.decision = { ok: true, membresia: membresia("operario") };
    const Layout = (await import("./layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>CONTENIDO</p> }));
    expect(html).toContain("Domiciliarios");
    expect(html).not.toContain("Administración");
    expect(html).not.toContain("Invitar persona");
  });

  it("sin la membresía correcta: SinAcceso con cerrar sesión, sin marco ni contenido", async () => {
    estado.decision = { ok: false, motivo: "sin-membresia" };
    const Layout = (await import("./layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>CONTENIDO</p> }));
    expect(html).toContain("no pertenece a ninguna bodega");
    expect(html).toContain("Cerrar sesión");
    expect(html).not.toContain("CONTENIDO");
    expect(html).not.toContain("zilonix-seller-logo.svg");
    expect(html).not.toContain("/panel");
  });

  it("bodega suspendida: aviso de suspensión", async () => {
    estado.decision = { ok: false, motivo: "suspendida", membresia: membresia("operario") };
    const Layout = (await import("./layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>CONTENIDO</p> }));
    expect(html).toContain("suspendida");
    expect(html).not.toContain("CONTENIDO");
  });

  it("domiciliario: mismo marco, menú mínimo", async () => {
    estado.decision = { ok: true, membresia: membresia("domiciliario") };
    const Layout = (await import("@/app/domiciliario/(panel)/layout")).default;
    const html = renderToStaticMarkup(await Layout({ children: <p>CONTENIDO</p> }));
    expect(html).toContain("zilonix-seller-logo.svg");
    expect(html).toContain(">Domiciliario<");
    expect(html).toContain("Mis entregas");
    expect(html).toContain("Mi cuenta");
    expect(html).not.toContain("Administración");
  });
});

describe("menús", () => {
  it("todo apunta a /bodega o /domiciliario y los 'Próximamente' están deshabilitados", () => {
    const items = [...gruposBodega("admin_bodega"), ...gruposDomiciliario()].flatMap((g) => g.items);
    for (const i of items) expect(/^\/(bodega|domiciliario)(\/|$)/.test(i.href), i.href).toBe(true);
    for (const e of ["Recepción", "Inventario", "Despachos", "Mis entregas"]) {
      const i = items.find((x) => x.etiqueta === e);
      expect(i?.deshabilitada, e).toBe(true);
      expect(i?.titulo).toBe("Próximamente");
    }
  });
});
