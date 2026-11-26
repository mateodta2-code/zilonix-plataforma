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
  it("sin término o sin competidores válidos no se guarda nada", () => {
    expect(validarCompetidores({ itemId: "MCO1", termino: "", candidatos: 1, competidores: [bueno] })).toBeNull();
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 0, competidores: [] })).toBeNull();
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 1, competidores: "no es lista" })).toBeNull();
  });
  it("máximo 10 competidores", () => {
    const muchos = Array.from({ length: 25 }, () => bueno);
    expect(validarCompetidores({ itemId: "MCO1", termino: "x", candidatos: 25, competidores: muchos })?.competidores.length).toBeLessThanOrEqual(10);
  });
});
