// Rama feat/conectar-ia-administracion — lista ÚNICA de módulos que
// pueden usar la IA conectada. Un módulo nuevo = una línea acá (más la
// migración que actualiza el CHECK de ia_conexion_modulos, ver
// db/migrations/0031_*). La usan la UI, la API y el ayudante
// obtenerConexionIAParaModulo.
import type { ProveedorIA } from "./tipos";

export const MODULOS_IA = [
  { id: "promociones", etiqueta: "Promociones" },
  { id: "optimizacion", etiqueta: "Optimización" },
  { id: "investigacion", etiqueta: "Investigación" },
  // Ningún código la usa todavía: solo se deja elegida la IA.
  { id: "publicidad", etiqueta: "Publicidad", proximamente: true },
  // Lo usará el generador de imágenes de Publicar.
  { id: "publicaciones", etiqueta: "Publicaciones" },
  // Imágenes de «Crear con IA» en Publicar (PR2). Solo OpenAI y Google
  // generan imágenes desde fotos (lib/ia/imagen.ts).
  { id: "generacion_imagenes", etiqueta: "Generación de imágenes" },
] as const satisfies readonly { id: string; etiqueta: string; proximamente?: boolean }[];

export type ModuloIA = (typeof MODULOS_IA)[number]["id"];

export const IDS_MODULOS_IA: readonly ModuloIA[] = MODULOS_IA.map((m) => m.id);

// Proveedores que generan imágenes. Es el mismo criterio de
// proveedorGeneraImagenes (lib/ia/imagen.ts); se repite aquí porque ese
// archivo usa red/DNS del servidor y esto lo importa también la pantalla
// (el test lo compara contra la función real).
const PROVEEDORES_IMAGEN: readonly ProveedorIA[] = ["openai", "google"];

export const MENSAJE_IA_SIN_IMAGENES = "Esta IA no genera imágenes. Usa una de OpenAI o Google.";

// Pura: ¿este módulo puede usar una IA de este proveedor?
export function moduloAdmiteProveedor(modulo: ModuloIA, proveedor: ProveedorIA): boolean {
  if (modulo === "generacion_imagenes") return PROVEEDORES_IMAGEN.includes(proveedor);
  return true;
}

export const MAX_CONEXIONES_IA = 5;

export function esModuloIA(valor: unknown): valor is ModuloIA {
  return typeof valor === "string" && (IDS_MODULOS_IA as readonly string[]).includes(valor);
}

// Valida una lista de módulos recibida del navegador: todos válidos y
// sin repetidos. Devuelve null si algo no es válido (la API responde 400).
export function validarModulosIA(valor: unknown): ModuloIA[] | null {
  if (!Array.isArray(valor)) return null;
  if (!valor.every(esModuloIA)) return null;
  return Array.from(new Set(valor));
}
