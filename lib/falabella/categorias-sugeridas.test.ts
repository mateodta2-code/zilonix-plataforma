import { describe, expect, it } from "vitest";
import { leerRespuestaCategorias, preseleccionarCategorias } from "./categorias-sugeridas";

const lista = [
  { id: 1, ruta: "Hogar › Cocina › Encendedores" },
  { id: 2, ruta: "Hogar › Electrodomésticos › Planchas eléctricas" },
  { id: 3, ruta: "Tecnología › Cables › Cable USB" },
];

describe("categorías sugeridas", () => {
  it("la palabra rara pesa más que la común", () => {
    const r = preseleccionarCategorias(lista, "Encendedor eléctrico USB recargable");
    expect(r[0].id).toBe(1);
  });
  it("sin palabras útiles no sugiere", () => {
    expect(preseleccionarCategorias(lista, "de la")).toEqual([]);
  });
  it("de la IA solo acepta ids de la lista", () => {
    expect(leerRespuestaCategorias('texto {"ids":[3,99,1]}', lista).map((c) => c.id)).toEqual([3, 1]);
    expect(leerRespuestaCategorias("nada", lista)).toEqual([]);
  });
});
