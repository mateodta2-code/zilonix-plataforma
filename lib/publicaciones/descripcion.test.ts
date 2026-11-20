import { describe, expect, it } from "vitest";
import { armarDescripcion, leerPartesDescripcion, promptDescripcion } from "@/lib/publicaciones/descripcion";
import { leerFicha } from "@/lib/publicaciones/ficha";

const ficha = leerFicha({
  nombre: { valor: "Termo de acero 1 L", origen: "vendedor" },
  incluye: { valor: ["Termo", "Tapa con asa"], origen: "vendedor" },
});

const RESPUESTA = JSON.stringify({
  queEs: "Un termo de acero de 1 litro para llevar tus bebidas.",
  caracteristicas: ["Acero inoxidable", "Mantiene caliente 12 horas", "Tapa con asa"],
  beneficios: ["Ideal para el día a día", "Con 30 días de prueba", "Garantía de 1 año", "Cura la sed"],
  modoUso: ["Llena el termo", "Cierra la tapa"],
  preguntas: [{ pregunta: "¿Se puede lavar?", respuesta: "Sí, a mano." }, { pregunta: "¿Tiene devolución?", respuesta: "Sí, 30 días." }],
});

const PERMITIDO = "- Nombre del producto: Termo de acero 1 L";

describe("descripción: nada inventado", () => {
  it("quita promesas: días de prueba, garantías de la IA, devoluciones y palabras prohibidas", () => {
    const partes = leerPartesDescripcion(RESPUESTA, PERMITIDO);
    const texto = armarDescripcion(partes!, { ficha, garantia: "", idioma: "es-CO" });
    expect(texto).not.toMatch(/30 días/);
    expect(texto).not.toMatch(/GARANTÍA|Garantía/);
    expect(texto).not.toMatch(/Cura/);
    expect(texto).not.toMatch(/devolución/);
    expect(texto).not.toMatch(/12 horas/); // cifra que no está en la ficha
    expect(texto).toContain("Un termo de acero de 1 litro"); // el 1 sí está
    expect(texto).toContain("Ideal para el día a día");
    expect(texto).toContain("¿Se puede lavar?\nSí, a mano.");
  });

  it("«Garantía» solo con el texto del vendedor; «Se entrega con» solo con lo confirmado", () => {
    const partes = leerPartesDescripcion(RESPUESTA, PERMITIDO)!;
    const con = armarDescripcion(partes, { ficha, garantia: "Garantía del vendedor por defectos de fábrica.", idioma: "es-MX" });
    expect(con).toContain("GARANTÍA\nGarantía del vendedor por defectos de fábrica.");
    expect(con).toContain("SE ENTREGA CON\n- Termo\n- Tapa con asa");
    const supuesto = armarDescripcion(partes, { ficha: { ...ficha, incluye: { valor: ["Termo", "Bolsa"], origen: "supuesto" } }, garantia: "", idioma: "es-MX" });
    expect(supuesto).not.toContain("SE ENTREGA CON");
  });

  it("texto plano en el idioma del país; JSON inválido → null", () => {
    const pt = armarDescripcion(leerPartesDescripcion('{"queEs":"<b>Garrafa</b> térmica 😀"}', PERMITIDO)!, { ficha, garantia: "", idioma: "pt-BR" });
    expect(pt).toBe("O QUE É\nGarrafa térmica\n\nCONTEÚDO DA EMBALAGEM\n- Termo\n- Tapa con asa");
    expect(leerPartesDescripcion("no", PERMITIDO)).toBeNull();
    expect(promptDescripcion({ ficha, idioma: "pt-BR", pais: "Brasil" })).toMatch(/Em pt-BR|En pt-BR/);
  });
});
