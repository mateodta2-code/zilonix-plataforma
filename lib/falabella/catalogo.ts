import { llamarFalabella } from "@/lib/falabella/cliente";

// Fase 1 de "Publicar en Falabella" (solo lectura, no crea nada en la
// tienda): marcas, árbol de categorías y atributos por categoría.
//
// Los nombres de acción (GetBrands, GetCategoryTree, GetCategoryAttributes)
// y el flujo vienen de developers.falabella.com/docs/products-flow. El
// FORMATO EXACTO de sus respuestas JSON no está confirmado todavía contra
// una cuenta real: por eso los lectores de abajo son defensivos (aceptan
// objeto suelto o lista, nunca asumen una sola forma) y devuelven tipos
// propios y planos. Si Falabella devuelve otra forma, falla visible
// (lista vacía + el crudo disponible para depurar), no un dato inventado.

type Credenciales = { userId: string; apiKey: string; sellerId: string };

export type MarcaFalabella = { nombre: string };
export type CategoriaFalabella = { id: number; nombre: string; hoja: boolean; hijas: CategoriaFalabella[] };
export type AtributoCategoria = {
  nombre: string; // FeedName: el nombre del tag XML dentro de ProductData
  etiqueta: string;
  obligatorio: boolean;
  tipo: string; // tipo de input (texto, lista, número...)
  opciones: string[];
  esVariacion: boolean;
};

function comoLista<T>(valor: T | T[] | undefined | null): T[] {
  if (valor === undefined || valor === null) return [];
  return Array.isArray(valor) ? valor : [valor];
}

export function leerMarcas(body: unknown): MarcaFalabella[] {
  const crudo = (body as { Brands?: { Brand?: unknown } } | null)?.Brands?.Brand;
  return comoLista(crudo as { Name?: string } | { Name?: string }[] | undefined)
    .map((b) => ({ nombre: String(b?.Name ?? "").trim() }))
    .filter((m) => m.nombre);
}

type NodoCategoria = { CategoryId?: string | number; Name?: string; Children?: { Category?: NodoCategoria | NodoCategoria[] } | ""; };

function leerNodo(nodo: NodoCategoria): CategoriaFalabella {
  const hijas = nodo.Children && typeof nodo.Children === "object" ? comoLista(nodo.Children.Category).map(leerNodo) : [];
  return { id: Number(nodo.CategoryId), nombre: String(nodo.Name ?? ""), hoja: hijas.length === 0, hijas };
}

export function leerArbolCategorias(body: unknown): CategoriaFalabella[] {
  const crudo = (body as { Categories?: { Category?: NodoCategoria | NodoCategoria[] } } | null)?.Categories?.Category;
  return comoLista(crudo).map(leerNodo).filter((c) => Number.isFinite(c.id));
}

// Solo las categorías donde SÍ se puede publicar son las hojas.
export function aplanarHojas(arbol: CategoriaFalabella[], ruta: string[] = []): { id: number; ruta: string }[] {
  return arbol.flatMap((c) => {
    const rutaActual = [...ruta, c.nombre];
    return c.hoja ? [{ id: c.id, ruta: rutaActual.join(" › ") }] : aplanarHojas(c.hijas, rutaActual);
  });
}

type NodoAtributo = {
  Name?: string;
  Label?: string;
  FeedName?: string;
  IsMandatory?: string | number | boolean;
  InputType?: string;
  GroupName?: string;
  Options?: { Option?: { Name?: string } | { Name?: string }[] } | "";
};

export function leerAtributos(body: unknown): AtributoCategoria[] {
  const crudo = (body as { Attribute?: NodoAtributo | NodoAtributo[] } | null)?.Attribute;
  return comoLista(crudo).map((a) => ({
    nombre: String(a.FeedName || a.Name || "").trim(),
    etiqueta: String(a.Label || a.Name || a.FeedName || "").trim(),
    obligatorio: a.IsMandatory === 1 || a.IsMandatory === "1" || a.IsMandatory === true,
    tipo: String(a.InputType ?? "texto"),
    opciones: a.Options && typeof a.Options === "object" ? comoLista(a.Options.Option).map((o) => String(o?.Name ?? "")).filter(Boolean) : [],
    esVariacion: String(a.GroupName ?? "").toLowerCase() === "variation",
  })).filter((a) => a.nombre);
}

export async function obtenerMarcas(cred: Credenciales): Promise<MarcaFalabella[]> {
  return leerMarcas(await llamarFalabella({ ...cred, action: "GetBrands", version: "1.0" }));
}

export async function obtenerArbolCategorias(cred: Credenciales): Promise<CategoriaFalabella[]> {
  return leerArbolCategorias(await llamarFalabella({ ...cred, action: "GetCategoryTree", version: "1.0" }));
}

export async function obtenerAtributosCategoria(cred: Credenciales, categoriaId: number): Promise<AtributoCategoria[]> {
  if (!Number.isInteger(categoriaId) || categoriaId <= 0) throw new Error("Categoría de Falabella inválida.");
  return leerAtributos(
    await llamarFalabella({ ...cred, action: "GetCategoryAttributes", version: "1.0", parametros: { PrimaryCategory: String(categoriaId) } })
  );
}
