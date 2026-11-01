import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PrivacidadPage from "./page";

describe("/privacidad", () => {
  it("carga sin sesión y muestra 'En preparación'", () => {
    const html = renderToStaticMarkup(PrivacidadPage());
    expect(html).toContain("Privacidad");
    expect(html).toContain("En preparación.");
  });
});
