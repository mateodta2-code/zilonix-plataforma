import { describe, expect, it } from "vitest";
import { esLinkDeDisenoCanva } from "./canva-link";

describe("esLinkDeDisenoCanva", () => {
  it("link corto de Compartir (canva.link/...) es un diseño", () => {
    expect(esLinkDeDisenoCanva("https://canva.link/AbCdEf")).toBe(true);
  });

  it("link largo de edición (canva.com/design/<id>/...) es un diseño", () => {
    expect(esLinkDeDisenoCanva("https://www.canva.com/design/DAFxyz123/edit")).toBe(true);
    expect(esLinkDeDisenoCanva("https://canva.com/design/DAFxyz123/view")).toBe(true);
  });

  // Hallazgo HIGH del review (PR #368) — antes, cualquier *.canva.com
  // (incluido media.canva.com) se trataba como diseño y rompía el
  // camino de "ya tengo la exportación hecha, solo pegar el link".
  it("media.canva.com (exportación ya hecha) NO es un diseño", () => {
    expect(esLinkDeDisenoCanva("https://media.canva.com/v2/export/abc123.png")).toBe(false);
  });

  it("*.canvausercontent.com (exportación ya hecha) NO es un diseño", () => {
    expect(esLinkDeDisenoCanva("https://export-download.canvausercontent.com/abc.png")).toBe(false);
  });

  it("canva.com sin /design/ en el path NO es un diseño", () => {
    expect(esLinkDeDisenoCanva("https://www.canva.com/p/alguna-otra-pagina")).toBe(false);
  });

  it("un host que no es de Canva no es un diseño", () => {
    expect(esLinkDeDisenoCanva("https://atacante.ejemplo.com/design/DAxyz/edit")).toBe(false);
  });

  it("una URL inválida no es un diseño", () => {
    expect(esLinkDeDisenoCanva("no-es-una-url")).toBe(false);
  });
});
