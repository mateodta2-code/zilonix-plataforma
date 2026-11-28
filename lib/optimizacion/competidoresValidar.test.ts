import { describe, expect, it } from "vitest";
import { validarCompetidores } from "./competidoresExtension";

const bueno = { link: "https://articulo.mercadolibre.com.co/MCO-1-algo", itemId: "MCO123456789", titulo: "Otro", precio: 1000, foto: "https://http2.mlstatic.com/a.jpg" };

describe("validarCompetidores", () => {
  it("deja pasar competidores válidos y normaliza los datos", () => {
    const r = validarCompetidores({ itemId: "MCO1", termino: " lámpara led ", candidatos: 12, competidores: [bueno] });
    expect(r?.termino).toBe("lámpara led");
    expect(r?.candidatos).toBe(12);
    expect(r?.competidores[0]).toMatchObject({ itemId: "MCO123456789", precio: 1000, leidoDeFicha: false });
  });
  it("descarta enlaces que no son de Mercado Libre y fotos ajenas", () => {
    const r = validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 2, competidores: [{ ...bueno, link: "https://malo.example.com/x" }, { ...bueno, foto: "https://malo.example.com/f.jpg" }] });
    expect(r?.competidores).toHaveLength(1);
    expect(r?.competidores[0].foto).toBeNull();
  });
  it("sin competidores válidos o sin lista no se guarda; sin término se guarda como «(por link)»; una lista vacía es válida (la persona quitó todos)", () => {
    expect(validarCompetidores({ itemId: "MCO1", termino: "", candidatos: 1, competidores: [bueno] })?.termino).toBe("(por link)");
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 0, competidores: [] })?.competidores).toEqual([]);
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 1, competidores: "no es lista" })).toBeNull();
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 1, competidores: [{ ...bueno, link: "https://malo.example.com/x" }] })).toBeNull();
  });
  it("máximo 30 competidores guardados (10 de la búsqueda + los agregados por link)", () => {
    const muchos = Array.from({ length: 45 }, () => bueno);
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 45, competidores: muchos })?.competidores.length).toBe(30);
  });
});
