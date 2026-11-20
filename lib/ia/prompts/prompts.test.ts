import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { leerFicha } from "@/lib/publicaciones/ficha";
import { asignarComposiciones, COMPOSICIONES_PORTADA_ZILONIX, ESCENAS_USO, otraComposicion } from "./composiciones";
import { datosProductoDesdeFicha } from "./datosProducto";
import { promptExpertoML, tipoExpertoDisponible, TIPOS_EXPERTO_ML } from "./estiloExpertoML";
import { FOTO_PRINCIPAL_POR_DEFECTO, promptFotoPrincipal } from "./fotoPrincipal";
import { ESTILOS_PROMPT_IMAGEN, TAMANO_SALIDA_PX } from "./index";
import {
  leerOpinionesReales,
  leerPropuestaContenidoZilonix,
  plantillaContenido,
  promptFinalContenido,
  revisarCopySeguro,
  TEXTO_ORIGINAL_CONTENIDO,
  tipoContenidoDisponible,
  TIPOS_CONTENIDO_ZILONIX,
} from "./zilonix-contenido";
import { promptZilonixPortada, TEXTO_ORIGINAL_PORTADAS } from "./zilonix-portadas";

const fixture = (nombre: string) => readFileSync(join(process.cwd(), "lib/ia/prompts/__fixtures__", nombre), "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "");

const FICHA = leerFicha({
  nombre: { valor: "Crema hidratante 50 g", origen: "vendedor" },
  uso: { valor: "Cuidado diario de la piel", origen: "vendedor" },
  incluye: { valor: ["Frasco de 50 g"], origen: "foto" },
  alto: { valor: "8 cm", origen: "vendedor" },
});
const DATOS = datosProductoDesdeFicha(FICHA, "MLM");

describe("textos de Mateo, tal cual", () => {
  it("son idénticos a sus fixtures (el anexo de la tarea)", () => {
    expect(TEXTO_ORIGINAL_PORTADAS).toBe(fixture("zilonix-portadas.txt"));
    expect(TEXTO_ORIGINAL_CONTENIDO).toBe(fixture("zilonix-contenido.txt"));
  });

  it("el prompt de portada los contiene completos y los ajustes van al final", () => {
    const p = promptZilonixPortada(DATOS, { indice: 2, cantidad: 3, asignacion: { composicion: 1, escena: 0 } });
    expect(p).toContain(TEXTO_ORIGINAL_PORTADAS);
    expect(p.indexOf("AJUSTES DE ZILONIX SELLER")).toBeGreaterThan(p.indexOf(TEXTO_ORIGINAL_PORTADAS));
    expect(p).toContain("la de la cuenta 2 de 3");
    expect(p).toContain("500 × 500");
    expect(p).toContain("Idioma de cualquier elemento visual: es-MX. País: México.");
  });

  it("registro sanitario vacío → pide no mostrar ningún registro", () => {
    const p = promptZilonixPortada(DATOS, { indice: 1, cantidad: 1, asignacion: { composicion: 0, escena: 0 } });
    expect(p).toMatch(/no muestres ni menciones ningún registro/);
  });
});

describe("una portada por cuenta, nunca repetida", () => {
  it("3 cuentas → 3 composiciones distintas", () => {
    const a = asignarComposiciones(["c1", "c2", "c3"]);
    expect(new Set(Object.values(a).map((x) => x.composicion)).size).toBe(3);
  });

  it("20 cuentas → ninguna pareja composición/escena repetida", () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const a = asignarComposiciones(ids);
    expect(new Set(Object.values(a).map((x) => `${x.composicion}:${x.escena}`)).size).toBe(20);
    expect(COMPOSICIONES_PORTADA_ZILONIX.length).toBeGreaterThanOrEqual(14);
    expect(ESCENAS_USO.length).toBeGreaterThan(1);
  });

  it("agregar una cuenta solo asigna la que falta; regenerar no repite", () => {
    const antes = asignarComposiciones(["c1", "c2"]);
    const despues = asignarComposiciones(["c1", "c2", "c3"], antes);
    expect(despues.c1).toEqual(antes.c1);
    expect(despues.c2).toEqual(antes.c2);
    const nueva = otraComposicion("c2", despues);
    const otras = Object.entries(despues).filter(([id]) => id !== "c2").map(([, x]) => x.composicion);
    expect(otras).not.toContain(nueva.composicion);
    expect(nueva.composicion).not.toBe(despues.c2.composicion);
  });
});

describe("Contenido Zilonix", () => {
  it("los 10 tipos en orden y encendidos; la 9 es «Opiniones reales» (decisión de Mateo), nunca reseñas de la IA", () => {
    expect(TIPOS_CONTENIDO_ZILONIX.map((t) => t.id)).toEqual([
      "modo_uso",
      "caracteristicas",
      "beneficios",
      "ventajas",
      "que_incluye",
      "como_funciona",
      "tabla_comparacion",
      "contexto_uso",
      "opiniones_reales",
      "preguntas_frecuentes",
    ]);
    expect(TIPOS_CONTENIDO_ZILONIX.every((t) => t.porDefecto)).toBe(true);
    expect(tipoContenidoDisponible("opiniones_reales", DATOS)).toMatchObject({ ok: false }); // sin opiniones, se salta
    expect(tipoContenidoDisponible("opiniones_reales", DATOS, ["Llegó rápido y bien empacado"])).toEqual({ ok: true });
  });

  it("las opiniones reales se limpian y se descartan las que prometen resultados", () => {
    expect(leerOpinionesReales('- "Llegó rápido y bien empacado"\n\nMe curó la piel en una semana\n• Buena presentación')).toEqual(["Llegó rápido y bien empacado", "Buena presentación"]);
    expect(leerOpinionesReales(42)).toEqual([]);
  });

  it("revisarCopySeguro bloquea «cura», «garantizado» y «antes/después»", () => {
    expect(revisarCopySeguro(["Cura la resequedad"])).toContain("cura / curar");
    expect(revisarCopySeguro(["Resultados garantizados"]).length).toBeGreaterThan(0);
    expect(revisarCopySeguro(["Mira el antes y después"])).toContain("antes / después");
    expect(revisarCopySeguro(["Sensación de frescura", "Ideal para el uso diario"])).toEqual([]);
  });

  it("el prompt final es la plantilla del punto 6 con sus [ ] llenos y los ajustes de país", () => {
    expect(plantillaContenido()).toMatch(/^Imagen publicitaria hiperrealista/);
    const p = promptFinalContenido({ tipo: "modo_uso", titulo: "Así se usa", copy: ["Limpia", "Aplica"], composicion: "derecha" }, DATOS);
    expect(p).toContain("Composición: producto a derecha.");
    expect(p).not.toContain("[bullets]");
    expect(p).toContain("Ignora «Mercado Libre Colombia» del texto anterior: usa Mercado Libre México");
    expect(p).toContain("Idioma de todo el texto: es-MX");
  });

  it("que_incluye pide lo incluido confirmado; la propuesta se lee sin confiar", () => {
    const sinIncluye = datosProductoDesdeFicha(leerFicha({ nombre: { valor: "Crema", origen: "vendedor" } }), "MCO");
    expect(tipoContenidoDisponible("que_incluye", sinIncluye)).toEqual({ ok: false, motivo: "Confirma qué incluye para crear esta imagen." });
    expect(leerPropuestaContenidoZilonix("modo_uso", '{"titulo":"Así se usa","copy":["- Limpia"],"composicion":"arriba"}')).toEqual({
      tipo: "modo_uso",
      titulo: "Así se usa",
      copy: ["Limpia"],
      composicion: "izquierda",
    });
  });
});

describe("Estilo experto ML y foto sobre blanco", () => {
  it("llena todas las variables", () => {
    const p = promptExpertoML(DATOS, "beneficio_principal", { titular: "Hidratación diaria", apoyos: ["Textura ligera"] });
    expect(p).not.toMatch(/\{\w+\}/);
    expect(p).toContain("«Hidratación diaria»");
    expect(p).toContain("Mercado Libre (México)");
  });

  it("medidas y que_incluye se deshabilitan sin datos confirmados", () => {
    const vacia = datosProductoDesdeFicha(leerFicha({ nombre: { valor: "Crema", origen: "vendedor" } }), "MCO");
    expect(tipoExpertoDisponible("medidas", vacia)).toMatchObject({ ok: false, motivo: "Confirma las medidas para crear esta imagen." });
    expect(tipoExpertoDisponible("medidas", DATOS)).toEqual({ ok: true });
    expect(TIPOS_EXPERTO_ML.filter((t) => t.porDefecto).map((t) => t.id)).toEqual(["beneficio_principal", "anatomia", "medidas", "que_incluye", "comparativa", "estilo_vida"]);
  });

  it("la foto sobre blanco es opcional y viene apagada; salida 500 × 500; tres estilos", () => {
    expect(FOTO_PRINCIPAL_POR_DEFECTO).toBe(false);
    expect(promptFotoPrincipal(DATOS)).toMatch(/fondo blanco puro \(#FFFFFF\)/);
    expect(TAMANO_SALIDA_PX).toBe(500);
    expect(ESTILOS_PROMPT_IMAGEN.map((e) => e.id)).toEqual(["zilonix_portadas", "zilonix_contenido", "experto_ml"]);
  });

  it("un dato supuesto nunca entra a los prompts", () => {
    const d = datosProductoDesdeFicha(leerFicha({ nombre: { valor: "Crema", origen: "vendedor" }, registroSanitario: { valor: "INVIMA 123", origen: "supuesto" } }), "MCO");
    expect(d.registroSanitario).toBe("");
  });
});
