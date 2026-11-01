import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import TerminosPage from "./page";

// Tarea feat-portada-pagina-venta — página estática, sin sesión ni
// Clerk de por medio (a diferencia de app/page.test.tsx, no hace falta
// mockear nada acá).
describe("/terminos", () => {
  it("carga sin sesión y muestra 'En preparación'", () => {
    const html = renderToStaticMarkup(TerminosPage());
    expect(html).toContain("Términos");
    expect(html).toContain("En preparación.");
  });
});
