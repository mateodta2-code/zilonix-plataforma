import { describe, expect, it } from "vitest";
import { datosProductoDesdeFicha } from "@/lib/ia/prompts/datosProducto";
import { TEXTO_ORIGINAL_PORTADAS } from "@/lib/ia/prompts/zilonix-portadas";
import { leerFicha } from "@/lib/publicaciones/ficha";
import { faltaParaCrearImagen, leerPropuestaPortada, leerPropuestaTextos, promptDeImagen, resumenDiagnostico, TIPO_FOTO_PRINCIPAL } from "@/lib/publicaciones/imagenesIA";

const DATOS = datosProductoDesdeFicha(leerFicha({ nombre: { valor: "Termo 1 L", origen: "vendedor" }, incluye: { valor: ["Tapa"], origen: "foto" } }), "MLA");

describe("de la propuesta guardada al prompt", () => {
  it("portada: el texto de Mateo con la cuenta y la composición de esa cuenta", () => {
    const p = promptDeImagen("zilonix_portadas", "portada", { cuentaMlId: "c1", indice: 1, cantidad: 2, asignacion: { composicion: 3, escena: 1 } }, DATOS);
    expect(p).toContain(TEXTO_ORIGINAL_PORTADAS);
    expect(p).toContain("la de la cuenta 1 de 2");
    expect(p).toContain("País: Argentina");
  });

  it("contenido y experto usan el título y copy editados", () => {
    expect(promptDeImagen("zilonix_contenido", "modo_uso", { titulo: "Así se usa", copy: ["Abre"], composicion: "centro" }, DATOS)).toContain("producto a centro");
    expect(promptDeImagen("experto_ml", "anatomia", { titulo: "Partes", copy: ["Tapa hermética"] }, DATOS)).toContain("«Tapa hermética»");
    expect(promptDeImagen("experto_ml", "tipo_inventado", { titulo: "x" }, DATOS)).toBeNull();
    expect(promptDeImagen("zilonix_contenido", TIPO_FOTO_PRINCIPAL, {}, DATOS)).toMatch(/fondo blanco puro/);
  });

  it("nunca se confía en la propuesta: portada inválida → null; textos limpios", () => {
    expect(leerPropuestaPortada({ cuentaMlId: "c1", indice: 3, cantidad: 2, asignacion: { composicion: 0, escena: 0 } })).toBeNull();
    expect(leerPropuestaPortada({ cuentaMlId: "c1", indice: 1, cantidad: 1, asignacion: { composicion: -1, escena: 0 } })).toBeNull();
    expect(leerPropuestaTextos({ titulo: "  Así   se usa ", copy: ["", " Abre ", 3], composicion: "arriba" })).toEqual({ titulo: "Así se usa", copy: ["Abre"] });
  });

  it("palabras prohibidas o sin título: no se crea", () => {
    expect(faltaParaCrearImagen("zilonix_contenido", "beneficios", { titulo: "Beneficios", copy: ["Cura la resequedad"] })).toMatch(/cura/);
    expect(faltaParaCrearImagen("experto_ml", "anatomia", { titulo: "" })).toMatch(/título/);
    expect(faltaParaCrearImagen("zilonix_portadas", "portada", {})).toBeNull();
  });

  it("diagnóstico: solo informa; un 429 o un fallo = «No se pudo validar»", () => {
    expect(resumenDiagnostico(429, null)).toEqual({ validado: false, avisos: ["No se pudo validar la imagen con Mercado Libre."] });
    expect(resumenDiagnostico(200, { diagnostics: [{ type: "white_background", action: "warning" }] })).toEqual({ validado: true, avisos: ["white_background", "warning"] });
  });
});
