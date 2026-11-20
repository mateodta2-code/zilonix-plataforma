// Publicar → «Crear con IA» (PR1, textos) — la FICHA del producto: lo
// que la IA de texto de la empresa leyó de las fotos y de lo que escribió
// el vendedor. Puro (sin servidor): lo usan la pantalla y las acciones.
//
// Regla de producto: nada inventado. Cada campo dice de dónde salió
// («foto», «vendedor» o «supuesto»). Un «supuesto» con valor bloquea la
// ficha hasta que la persona lo confirme o lo borre: los títulos, la
// descripción y (en el PR2) las imágenes solo usan la ficha confirmada.
// zod no está en el proyecto: se valida a mano, con pruebas.

import { datosSitioMl } from "@/lib/ml/sitios";

export const ORIGENES = ["foto", "vendedor", "supuesto"] as const;
export type Origen = (typeof ORIGENES)[number];

export const CAMPOS_FICHA = [
  { clave: "nombre", etiqueta: "Nombre del producto", tipo: "texto" },
  { clave: "color", etiqueta: "Color", tipo: "texto" },
  { clave: "material", etiqueta: "Material", tipo: "texto" },
  { clave: "uso", etiqueta: "Uso principal", tipo: "texto" },
  { clave: "publicoObjetivo", etiqueta: "Público objetivo", tipo: "texto" },
  { clave: "registroSanitario", etiqueta: "Registro sanitario (si aplica)", tipo: "texto" },
  { clave: "fraseGancho", etiqueta: "Frase gancho", tipo: "texto" },
  { clave: "alto", etiqueta: "Alto", tipo: "texto", grupo: "medidas" },
  { clave: "ancho", etiqueta: "Ancho", tipo: "texto", grupo: "medidas" },
  { clave: "largo", etiqueta: "Largo", tipo: "texto", grupo: "medidas" },
  { clave: "capacidad", etiqueta: "Capacidad", tipo: "texto", grupo: "medidas" },
  { clave: "peso", etiqueta: "Peso", tipo: "texto", grupo: "medidas" },
  { clave: "incluye", etiqueta: "Qué incluye", tipo: "lista" },
  { clave: "ingredientes", etiqueta: "Ingredientes o componentes", tipo: "lista" },
  { clave: "caracteristicas", etiqueta: "Características", tipo: "lista" },
  { clave: "beneficios", etiqueta: "Beneficios", tipo: "lista" },
  { clave: "modoUso", etiqueta: "Modo de uso", tipo: "lista" },
  { clave: "objeciones", etiqueta: "Dudas del comprador", tipo: "lista" },
  { clave: "diferenciadores", etiqueta: "Diferenciadores", tipo: "lista" },
] as const satisfies readonly { clave: string; etiqueta: string; tipo: "texto" | "lista"; grupo?: string }[];

export type ClaveFicha = (typeof CAMPOS_FICHA)[number]["clave"];
export type CampoTexto = { valor: string | null; origen: Origen };
export type CampoLista = { valor: string[]; origen: Origen };
export type Ficha = { [K in ClaveFicha]: Extract<(typeof CAMPOS_FICHA)[number], { clave: K }>["tipo"] extends "lista" ? CampoLista : CampoTexto };

export const LARGO_TEXTO = 160;
export const LARGO_ITEM = 200;
export const MAXIMO_ITEMS = 10;
export const LARGO_INFO_VENDEDOR = 2_000;
export const LARGO_GARANTIA = 300;
export const MAXIMO_FOTOS_ANALISIS = 5;

// Lo que algunas IA devuelven cuando no saben un dato: nunca se muestra.
const VACIOS = new Set(["n/a", "na", "n.a.", "no aplica", "no disponible", "desconocido", "unknown", "null", "none", "-", "—", "?", "sin dato", "sin información"]);

export function idiomaDeSitio(siteId: string): { idioma: string; pais: string } {
  const sitio = datosSitioMl(siteId);
  return { idioma: sitio.idioma, pais: sitio.nombre };
}

function limpiarTexto(valor: unknown, largo: number): string | null {
  if (typeof valor !== "string" && typeof valor !== "number") return null;
  const texto = String(valor)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, largo);
  return texto && !VACIOS.has(texto.toLowerCase()) ? texto : null;
}

function leerOrigen(valor: unknown): Origen {
  // Sin origen válido se trata como supuesto: lo más prudente.
  return ORIGENES.includes(valor as Origen) ? (valor as Origen) : "supuesto";
}

function leerCampo(tipo: "texto" | "lista", crudo: unknown): CampoTexto | CampoLista {
  const objeto = crudo !== null && typeof crudo === "object" && !Array.isArray(crudo) ? (crudo as Record<string, unknown>) : null;
  const valor = objeto ? objeto.valor : crudo;
  const origen = leerOrigen(objeto?.origen);
  if (tipo === "lista") {
    const lista = (Array.isArray(valor) ? valor : typeof valor === "string" ? valor.split("\n") : [])
      .map((v) => limpiarTexto(v, LARGO_ITEM))
      .filter((v): v is string => v !== null)
      .slice(0, MAXIMO_ITEMS);
    return { valor: lista, origen };
  }
  return { valor: limpiarTexto(valor, LARGO_TEXTO), origen };
}

export function fichaVacia(): Ficha {
  const ficha = {} as Record<ClaveFicha, CampoTexto | CampoLista>;
  for (const c of CAMPOS_FICHA) ficha[c.clave] = c.tipo === "lista" ? { valor: [], origen: "vendedor" } : { valor: null, origen: "vendedor" };
  return ficha as Ficha;
}

// Lee una ficha que llega de la IA o del navegador: nunca se confía.
// Acepta { campo: { valor, origen } } y, para medidas, { medidas: { alto: … } }.
export function leerFicha(crudo: unknown): Ficha {
  const d = crudo !== null && typeof crudo === "object" ? (crudo as Record<string, unknown>) : {};
  const medidas = d.medidas !== null && typeof d.medidas === "object" ? (d.medidas as Record<string, unknown>) : {};
  const ficha = {} as Record<ClaveFicha, CampoTexto | CampoLista>;
  for (const c of CAMPOS_FICHA) {
    const valor = "grupo" in c && c.grupo === "medidas" ? (d[c.clave] ?? medidas[c.clave]) : d[c.clave];
    ficha[c.clave] = leerCampo(c.tipo, valor);
  }
  return ficha as Ficha;
}

// Saca el primer objeto JSON de la respuesta (algunas IA lo envuelven en
// ```json o agregan una frase). null si no hay JSON usable.
export function extraerJson(respuesta: string): Record<string, unknown> | null {
  const inicio = respuesta.indexOf("{");
  const fin = respuesta.lastIndexOf("}");
  if (inicio < 0 || fin <= inicio) return null;
  try {
    const dato = JSON.parse(respuesta.slice(inicio, fin + 1)) as unknown;
    return dato !== null && typeof dato === "object" && !Array.isArray(dato) ? (dato as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function tieneValor(campo: CampoTexto | CampoLista): boolean {
  return Array.isArray(campo.valor) ? campo.valor.length > 0 : campo.valor !== null;
}

// Los campos que todavía son «supuesto» y tienen valor: hay que
// confirmarlos (o borrarlos) antes de usar la ficha.
export function camposPorConfirmar(ficha: Ficha): ClaveFicha[] {
  return CAMPOS_FICHA.filter((c) => ficha[c.clave].origen === "supuesto" && tieneValor(ficha[c.clave])).map((c) => c.clave);
}

export function fichaConfirmada(ficha: Ficha): boolean {
  return camposPorConfirmar(ficha).length === 0 && ficha.nombre.valor !== null;
}

// La ficha en texto para los prompts: solo lo que tiene valor (y, por
// fichaConfirmada, nada supuesto).
export function fichaEnTexto(ficha: Ficha): string {
  return CAMPOS_FICHA.filter((c) => tieneValor(ficha[c.clave]))
    .map((c) => {
      const v = ficha[c.clave].valor;
      return `- ${c.etiqueta}: ${Array.isArray(v) ? v.join("; ") : v}`;
    })
    .join("\n");
}

// Cifras (medidas, tiempos, capacidades) que la IA escribe y que no
// están en la ficha confirmada: no se pueden mostrar. true = el texto
// solo usa números que aparecen en `permitido`.
export function soloCifrasConfirmadas(texto: string, permitido: string): boolean {
  const numeros = (t: string) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", "."));
  const ok = new Set(numeros(permitido));
  return numeros(texto).every((n) => ok.has(n));
}

export function limpiarInfoVendedor(valor: unknown, largo = LARGO_INFO_VENDEDOR): string {
  return typeof valor === "string" ? valor.replace(/<[^>]*>/g, " ").replace(/[ \t]+/g, " ").trim().slice(0, largo) : "";
}
