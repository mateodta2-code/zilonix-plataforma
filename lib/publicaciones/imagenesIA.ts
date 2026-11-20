// Publicar → «Crear con IA» (PR2) — de lo guardado (estilo, tipo y
// propuesta de cada imagen) al prompt final. Puro: lo usan la vista
// previa (prompt copiable) y la acción que crea la imagen, así lo que se
// muestra es exactamente lo que se manda. En la base nunca se guarda el
// prompt completo: se vuelve a armar desde la propuesta.

import { extraerJson } from "@/lib/publicaciones/ficha";
import type { Asignacion } from "@/lib/ia/prompts/composiciones";
import type { DatosProducto } from "@/lib/ia/prompts/datosProducto";
import { promptExpertoML, TIPOS_EXPERTO_ML, type TipoExpertoML } from "@/lib/ia/prompts/estiloExpertoML";
import { promptFotoPrincipal } from "@/lib/ia/prompts/fotoPrincipal";
import type { EstiloImagen } from "@/lib/ia/prompts/index";
import { promptFinalContenido, revisarCopySeguro, TIPOS_CONTENIDO_ZILONIX, type ComposicionContenido, type TipoContenidoZilonix } from "@/lib/ia/prompts/zilonix-contenido";
import { promptZilonixPortada } from "@/lib/ia/prompts/zilonix-portadas";

export const TIPO_PORTADA = "portada";
export const TIPO_FOTO_PRINCIPAL = "foto_principal";

export type PropuestaPortada = { cuentaMlId: string; indice: number; cantidad: number; asignacion: Asignacion };
export type PropuestaTextos = { titulo: string; copy: string[]; composicion?: ComposicionContenido };

function esAsignacion(v: unknown): v is Asignacion {
  const a = v as Asignacion | null;
  return !!a && Number.isInteger(a.composicion) && Number.isInteger(a.escena) && a.composicion >= 0 && a.escena >= 0;
}

export function leerPropuestaPortada(v: unknown): PropuestaPortada | null {
  const p = v as Record<string, unknown> | null;
  if (!p || typeof p.cuentaMlId !== "string" || !esAsignacion(p.asignacion)) return null;
  const indice = Number(p.indice);
  const cantidad = Number(p.cantidad);
  if (!Number.isInteger(indice) || !Number.isInteger(cantidad) || indice < 1 || cantidad < indice) return null;
  return { cuentaMlId: p.cuentaMlId, indice, cantidad, asignacion: p.asignacion };
}

// Título y copy (Contenido Zilonix y Experto ML), editables por la persona.
export function leerPropuestaTextos(v: unknown): PropuestaTextos | null {
  const p = v as Record<string, unknown> | null;
  if (!p) return null;
  const titulo = typeof p.titulo === "string" ? p.titulo.replace(/\s+/g, " ").trim().slice(0, 60) : "";
  const copy = (Array.isArray(p.copy) ? p.copy : [])
    .filter((c): c is string => typeof c === "string")
    .map((c) => c.replace(/\s+/g, " ").trim().slice(0, 160))
    .filter(Boolean)
    .slice(0, 6);
  const composicion = p.composicion === "derecha" || p.composicion === "centro" || p.composicion === "izquierda" ? p.composicion : undefined;
  return titulo ? { titulo, copy, ...(composicion ? { composicion } : {}) } : null;
}

// Lo que impide crear: palabras prohibidas o falta de título.
export function faltaParaCrearImagen(estilo: EstiloImagen, tipo: string, propuesta: unknown): string | null {
  if (estilo === "zilonix_portadas" || tipo === TIPO_FOTO_PRINCIPAL) return null;
  const p = leerPropuestaTextos(propuesta);
  if (!p) return "Falta el título de la imagen.";
  const prohibidas = revisarCopySeguro([p.titulo, ...p.copy]);
  return prohibidas.length > 0 ? `Quita esto, Mercado Libre no lo permite: ${prohibidas.join(", ")}.` : null;
}

export function promptDeImagen(estilo: EstiloImagen, tipo: string, propuesta: unknown, datos: DatosProducto): string | null {
  if (tipo === TIPO_FOTO_PRINCIPAL) return promptFotoPrincipal(datos);
  if (estilo === "zilonix_portadas") {
    const p = leerPropuestaPortada(propuesta);
    return p ? promptZilonixPortada(datos, { indice: p.indice, cantidad: p.cantidad, asignacion: p.asignacion }) : null;
  }
  const p = leerPropuestaTextos(propuesta);
  if (!p) return null;
  if (estilo === "zilonix_contenido") {
    if (!TIPOS_CONTENIDO_ZILONIX.some((t) => t.id === tipo)) return null;
    return promptFinalContenido({ tipo: tipo as TipoContenidoZilonix, titulo: p.titulo, copy: p.copy, composicion: p.composicion ?? "izquierda" }, datos);
  }
  if (!TIPOS_EXPERTO_ML.some((t) => t.id === tipo)) return null;
  return promptExpertoML(datos, tipo as TipoExpertoML, { titular: p.titulo, apoyos: p.copy });
}

// Experto ML: la IA de texto propone titular y apoyos para un tipo.
export function promptTextosExperto(tipo: TipoExpertoML, datos: DatosProducto, ajuste: string): string {
  const info = TIPOS_EXPERTO_ML.find((t) => t.id === tipo)!;
  return [
    `Eres redactor de imágenes de venta para Mercado Libre ${datos.nombrePais}. Imagen: «${info.nombre}». Objetivo: ${info.objetivo}`,
    "Ficha confirmada (usa SOLO estos datos, no inventes cifras, medidas, garantías ni certificaciones):",
    datos.fichaConfirmada,
    ajuste ? `El vendedor pidió AJUSTAR: «${ajuste.slice(0, 300)}».` : "",
    `En ${datos.idioma}, con tildes. Un titular de máximo 6 palabras y de 2 a 4 apoyos de máximo 6 palabras cada uno. Sin promesas de salud ni palabras como curar, tratar, garantizado o expertos.`,
    'Responde SOLO un JSON: {"titulo": "…", "copy": ["…", "…"]}',
  ]
    .filter(Boolean)
    .join("\n");
}

export function leerTextosIA(respuesta: string): PropuestaTextos | null {
  return leerPropuestaTextos(extraerJson(respuesta));
}

// Diagnóstico de Mercado Libre: solo informa. Sin forma confirmada
// todavía (429 en staging), se leen los «type»/«action» que vengan.
export function resumenDiagnostico(status: number, data: unknown): { validado: boolean; avisos: string[] } {
  if (status !== 200 || !data) return { validado: false, avisos: ["No se pudo validar la imagen con Mercado Libre."] };
  const avisos = new Set<string>();
  const recorrer = (v: unknown, profundidad: number) => {
    if (profundidad > 4 || v === null || typeof v !== "object") return;
    if (Array.isArray(v)) return v.forEach((x) => recorrer(x, profundidad + 1));
    const o = v as Record<string, unknown>;
    for (const clave of ["type", "action"]) if (typeof o[clave] === "string" && (o[clave] as string).length <= 60) avisos.add(o[clave] as string);
    Object.values(o).forEach((x) => recorrer(x, profundidad + 1));
  };
  recorrer(data, 0);
  return { validado: true, avisos: [...avisos] };
}
