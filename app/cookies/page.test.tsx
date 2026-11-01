import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CookiesPage from "./page";

describe("/cookies", () => {
  it("carga sin sesión y muestra 'En preparación'", () => {
    const html = renderToStaticMarkup(CookiesPage());
    expect(html).toContain("Cookies");
    expect(html).toContain("En preparación.");
  });
});
