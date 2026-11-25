// Títulos SEO con la IA de texto de la empresa: el núcleo compartido por
// Publicar → «Crear con IA» y Optimización → «Mejorar título». Un solo
// prompt y una sola lectura (promptTitulos / leerPropuestaTitulos): nunca
// se copia esta lógica a otro módulo. Solo LEE de Mercado Libre.

import { llamarIA } from "@/lib/ia/proveedores";
import type { ConexionIAConClave } from "@/lib/ia/tipos";
import { tendenciasPorNivelMl } from "@/lib/ml/cliente";
import { ESPERA_TEXTO_MS } from "@/lib/publicaciones/analisis";
import { limpiarInfoVendedor, type Ficha } from "@/lib/publicaciones/ficha";
import { conCupoDeTexto } from "@/lib/publicaciones/freno";
import { filtrarTendenciasRelacionadas, leerPropuestaTitulos, ORDEN_PARA_IA, promptTitulos, unirTendenciasPorNivel, type PalabraClave, type TendenciaConNivel } from "@/lib/publicaciones/titulos";

export type TitulosGenerados = {
  titulos: string[];
  catalogo: string | null;
  palabras: PalabraClave[];
  keywordsPrincipales: string[];
  keywordsNoUtilizadas: string[];
  conTendencias: boolean;
  // «Más buscados en la categoría»: tendencias de la categoría general,
  // la padre y la específica, con su nivel, y la ruta analizada.
  masBuscados: TendenciaConNivel[];
  rutaCategoria: string[];
  // true = ML devolvió tendencias, pero ninguna se relaciona con el producto.
  tendenciasSinRelacion: boolean;
};

export type EntradaTitulosSeo = {
  empresaId: string;
  conexion: ConexionIAConClave;
  cuenta: { id: string; siteId: string };
  // Token de Mercado Libre para leer las tendencias; null = sin tendencias.
  token: (() => Promise<string>) | null;
  // Ficha YA confirmada (el llamador revisa fichaConfirmada).
  ficha: Ficha;
  categoriaId?: string | null;
  categoriaNombre?: string | null;
  info?: string;
  idioma: string;
  pais: string;
  // Solo el nombre del error, nunca datos del vendedor ni respuestas de la IA.
  registrar: (paso: string, error: unknown) => void;
};

// null = la IA respondió, pero sin títulos usables. Los errores de la IA
// (o del cupo) se lanzan: el llamador los traduce con mensajeErrorIA.
export async function generarTitulosSeo(entrada: EntradaTitulosSeo): Promise<TitulosGenerados | null> {
  const { ficha, idioma, pais } = entrada;
  let masBuscados: TendenciaConNivel[] = [];
  let rutaCategoria: string[] = [];
  let tendenciasSinRelacion = false;
  if (typeof entrada.categoriaId === "string" && entrada.categoriaId && entrada.token) {
    try {
      const token = await entrada.token();
      const r = await tendenciasPorNivelMl(entrada.cuenta.siteId, entrada.categoriaId, token);
      rutaCategoria = r.ruta;
      // Solo los VALORES de la ficha (sin las etiquetas «Nombre del producto»,
      // «Color»…, que harían coincidir cualquier búsqueda).
      const valores = Object.values(ficha).map((c) => (Array.isArray(c.valor) ? c.valor.join(" ") : (c.valor ?? "")));
      const textoProducto = `${valores.join(" ")} ${limpiarInfoVendedor(entrada.info)}`;
      const nombreCategoria = entrada.categoriaNombre ?? r.ruta[r.ruta.length - 1] ?? "";
      const relacionadas = filtrarTendenciasRelacionadas(r.niveles, textoProducto, nombreCategoria);
      masBuscados = unirTendenciasPorNivel(relacionadas.niveles);
      tendenciasSinRelacion = masBuscados.length === 0 && relacionadas.descartadas > 0;
    } catch (error) {
      entrada.registrar("tendencias", error);
    }
  }
  // Para la IA, primero las de la categoría específica (las más cercanas al producto).
  const tendencias = [...masBuscados].sort((a, b) => ORDEN_PARA_IA[a.nivel] - ORDEN_PARA_IA[b.nivel]).map((t) => t.palabra);
  const info = limpiarInfoVendedor(entrada.info);
  const categoria = typeof entrada.categoriaNombre === "string" ? entrada.categoriaNombre.slice(0, 120) : null;
  const respuesta = await conCupoDeTexto(entrada.empresaId, () =>
    llamarIA(entrada.conexion, promptTitulos({ ficha, idioma, pais, categoria, tendencias, info }), { maxTokens: 2000, timeoutMs: ESPERA_TEXTO_MS })
  );
  const propuesta = leerPropuestaTitulos(respuesta, { ficha, tendencias, info, niveles: masBuscados });
  if (!propuesta) return null;
  return { ...propuesta, conTendencias: tendencias.length > 0, masBuscados, rutaCategoria, tendenciasSinRelacion };
}
