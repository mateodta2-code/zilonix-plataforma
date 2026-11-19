import { describe, expect, it } from "vitest";
import { leerPropuestaContenido, promptPropuestaContenido } from "@/lib/ia/contenido";

describe("propuesta de contenido de la IA de texto", () => {
  it("el pedido usa la ficha como fuente principal y repite las reglas", () => {
    const p = promptPropuestaContenido("incluye", "Kit de brochas", "3 brochas + estuche", "Descripción larga");
    expect(p).toContain("3 brochas + estuche");
    expect(p).toContain("Kit de brochas");
    expect(p).toContain("Descripción larga");
    expect(p).toMatch(/No inventes ingredientes/);
    expect(p).toMatch(/Responde SOLO un JSON/);
  });

  it("lee el JSON aunque venga envuelto en texto o ```json", () => {
    const r = leerPropuestaContenido("modo_uso", 'Claro:\n```json\n{"titulo":"Así se usa","bullets":["Abre","Aplica","Listo"],"composicion":"centro"}\n```');
    expect(r).toEqual({ tipo: "modo_uso", titulo: "Así se usa", bullets: ["Abre", "Aplica", "Listo"], composicion: "centro" });
  });

  it("el tipo lo decide Zilonix, no la IA; una respuesta sin JSON no sirve", () => {
    expect(leerPropuestaContenido("faq", '{"tipo":"opiniones","titulo":"Preguntas","bullets":["¿Sirve? Sí"]}')?.tipo).toBe("faq");
    expect(leerPropuestaContenido("faq", "no sé")).toBeNull();
    expect(leerPropuestaContenido("faq", "{roto")).toBeNull();
    expect(leerPropuestaContenido("faq", '{"titulo":"","bullets":[]}')).toBeNull();
  });
});
