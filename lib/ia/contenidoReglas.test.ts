import { describe, expect, it } from "vitest";
import {
  faltaParaCrear,
  limpiarContenido,
  palabrasProhibidas,
  promptImagenContenido,
  tipoLoEscribeLaIA,
  TIPOS_CONTENIDO,
  type ContenidoImagen,
} from "@/lib/ia/contenidoReglas";

const LISTO: ContenidoImagen = {
  tipo: "modo_uso",
  titulo: "Así se usa",
  bullets: ["Abre la tapa", "Aplica una capa delgada", "Deja secar 5 minutos"],
  composicion: "derecha",
};

describe("palabras prohibidas (políticas de Mercado Libre)", () => {
  it("detecta las del prompt, sin importar tildes ni mayúsculas", () => {
    expect(palabrasProhibidas(["Cura el dolor"])).toEqual(["cura / curar"]);
    expect(palabrasProhibidas(["Tratamiento CLÍNICAMENTE probado"])).toEqual(["tratar / tratamiento", "clínicamente probado"]);
    expect(palabrasProhibidas(["Recomendado por expertos", "Resultados garantizados"])).toEqual(["recomendado por expertos", "garantizado"]);
    expect(palabrasProhibidas(["Elimina las manchas", "Fórmula anti-envejecimiento"])).toEqual(["elimina", "anti-envejecimiento"]);
    expect(palabrasProhibidas(["Mira el antes y después"])).toEqual(["antes / después"]);
    expect(palabrasProhibidas(["Desde el primer mes verás cambios"])).toEqual(["«desde el primer mes verás»"]);
  });

  it("no confunde palabras parecidas que sí se permiten", () => {
    expect(palabrasProhibidas(["Compra segura", "Contrato claro", "Sensación de frescura", "Apoya tu rutina de cuidado diario", "Garantía del vendedor"])).toEqual([]);
  });
});

describe("contenido de la imagen", () => {
  it("limpia lo que llega: viñetas, espacios, topes y composición desconocida", () => {
    const c = limpiarContenido({ tipo: "caracteristicas", titulo: "  Ficha   técnica ", bullets: ["- 500 ml", "• Vidrio", "", 3, "x".repeat(300), "2) Tapa"], composicion: "arriba" });
    expect(c).toEqual({ tipo: "caracteristicas", titulo: "Ficha técnica", bullets: ["500 ml", "Vidrio", "x".repeat(110), "Tapa"], composicion: "izquierda" });
    expect(limpiarContenido({ tipo: "inventado" })).toBeNull();
    expect(limpiarContenido(null)).toBeNull();
  });

  it("no se crea sin título, con pocas líneas o con palabras prohibidas", () => {
    expect(faltaParaCrear(LISTO)).toBeNull();
    expect(faltaParaCrear({ ...LISTO, titulo: "" })).toMatch(/título/);
    expect(faltaParaCrear({ ...LISTO, bullets: ["Solo una"] })).toMatch(/al menos 2/);
    expect(faltaParaCrear({ ...LISTO, bullets: [...LISTO.bullets, "Alivio inmediato"] })).toMatch(/alivio/);
  });

  it("los 10 tipos del prompt; las opiniones nunca las escribe la IA", () => {
    expect(TIPOS_CONTENIDO).toHaveLength(10);
    expect(TIPOS_CONTENIDO.filter((t) => !tipoLoEscribeLaIA(t.id)).map((t) => t.id)).toEqual(["opiniones"]);
  });

  it("el prompt final sigue la plantilla: producto idéntico, composición, textos exactos, sin claims", () => {
    const p = promptImagenContenido(LISTO, "Crema hidratante 50 g");
    expect(p).toMatch(/EXACTAMENTE igual a las fotos de referencia/);
    expect(p).toContain("producto a la derecha");
    expect(p).toContain('"Así se usa"');
    expect(p).toContain("2) Aplica una capa delgada");
    expect(p).toContain("Crema hidratante 50 g");
    expect(p).toMatch(/sin curas ni tratamientos/);
    expect(promptImagenContenido({ ...LISTO, tipo: "comparacion" }, null)).toMatch(/«Este producto» y «Otras opciones»/);
  });
});
