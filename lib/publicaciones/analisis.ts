// Publicar → «Crear con IA» — ANÁLISIS del producto con la IA de texto
// de la empresa (módulo «publicaciones» de Conectar IA). Mira las fotos
// reales (llamarIAConImagenes, si el modelo lee imágenes) y lo que
// escribió el vendedor, y devuelve la ficha con el origen de cada dato.
// La categoría NO la decide la IA: sale de Mercado Libre
// (resolverCategoria, domain_discovery) en la acción.

import { ErrorIASinVision, llamarIA, llamarIAConImagenes, type ImagenIA } from "@/lib/ia/proveedores";
import type { ConexionIAConClave } from "@/lib/ia/tipos";
import { CAMPOS_FICHA, extraerJson, leerFicha, type Ficha } from "./ficha";

export class ErrorAnalisisIA extends Error {}

export function promptAnalisis(entrada: { idioma: string; pais: string; info: string; conFotos: boolean }): string {
  const campos = CAMPOS_FICHA.map((c) => `"${c.clave}": { "valor": ${c.tipo === "lista" ? "[…] o []" : "\"…\" o null"}, "origen": "foto" | "vendedor" | "supuesto" }`).join(",\n  ");
  return [
    `Eres analista de producto para vender en Mercado Libre ${entrada.pais}.`,
    entrada.conFotos ? "Mira las fotos reales del producto adjuntas y lee la información del vendedor." : "Lee la información del vendedor (no hay fotos).",
    "",
    "Información del vendedor (fuente principal):",
    `"""${entrada.info || "(el vendedor no escribió nada)"}"""`,
    "",
    "Reglas obligatorias:",
    `- Escribe TODO en ${entrada.idioma}, con tildes y ortografía correctas. Nunca en inglés.`,
    "- «origen» de cada campo: \"foto\" si se ve en las fotos, \"vendedor\" si lo dice el vendedor, \"supuesto\" si lo deduces sin verlo ni leerlo.",
    "- Si no sabes un dato, \"valor\": null (o [] en listas). Nunca escribas «N/A», «desconocido» ni inventes medidas, capacidad, tiempos, garantías, certificaciones o comparaciones.",
    "- «objeciones»: dudas reales que tendría un comprador, escritas como pregunta.",
    "- Textos cortos y concretos. Sin precios, promociones ni promesas de salud.",
    "",
    `Responde SOLO un JSON con esta forma, sin nada más:\n{\n  ${campos}\n}`,
  ].join("\n");
}

export type ResultadoAnalisis = { ficha: Ficha; leyoFotos: boolean };

// Cuánto se espera a la IA en Publicar (24-nov): con 30 s el análisis con
// fotos salía seguido «no respondió a tiempo» (fotos + modelo que razona).
export const ESPERA_ANALISIS_MS = 90_000;
export const ESPERA_TEXTO_MS = 60_000;

// Si el modelo no lee imágenes, se repite solo con el texto del vendedor
// (y la pantalla lo avisa): nunca se cae el análisis por eso.
export async function analizarProducto(
  conexion: ConexionIAConClave,
  entrada: { idioma: string; pais: string; info: string; fotos: ImagenIA[] }
): Promise<ResultadoAnalisis> {
  let respuesta: string;
  let leyoFotos = entrada.fotos.length > 0;
  try {
    respuesta = leyoFotos
      ? await llamarIAConImagenes(conexion, promptAnalisis({ ...entrada, conFotos: true }), entrada.fotos, { maxTokens: 2_000, timeoutMs: ESPERA_ANALISIS_MS })
      : await llamarIA(conexion, promptAnalisis({ ...entrada, conFotos: false }), { maxTokens: 2_000, timeoutMs: ESPERA_TEXTO_MS });
  } catch (error) {
    if (!(error instanceof ErrorIASinVision)) throw error;
    leyoFotos = false;
    respuesta = await llamarIA(conexion, promptAnalisis({ ...entrada, conFotos: false }), { maxTokens: 2_000, timeoutMs: ESPERA_TEXTO_MS });
  }
  const json = extraerJson(respuesta);
  if (!json) throw new ErrorAnalisisIA("La IA no devolvió una ficha que se pueda leer. Intenta de nuevo.");
  const ficha = leerFicha(json);
  if (!ficha.nombre.valor) throw new ErrorAnalisisIA("La IA no reconoció el producto. Escribe qué es en «Información del producto» e intenta de nuevo.");
  return { ficha, leyoFotos };
}
