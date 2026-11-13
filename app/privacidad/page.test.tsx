import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacidadPage from "./page";

describe("/privacidad", () => {
  const html = renderToStaticMarkup(PrivacidadPage());

  it("carga sin sesión y muestra la política, ya no 'En preparación'", () => {
    expect(html).toContain("Política de Tratamiento de Datos Personales");
    expect(html).toContain("1. Responsable del tratamiento");
    expect(html).not.toContain("En preparación");
  });

  it("incluye la sección de la extensión de Chrome", () => {
    expect(html).toContain("Extensión de Chrome de Zilonix Seller");
    expect(html).toContain("no lee contraseñas");
  });

  it("deja los campos {{DATO: …}} tal cual y no deja Markdown crudo", () => {
    expect(html).toContain("{{DATO: razón social}}");
    expect(html).not.toContain("**");
    expect(html).not.toContain("## ");
  });
});
