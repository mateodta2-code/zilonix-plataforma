// Títulos SEO con la IA de texto de la empresa — núcleo COMPARTIDO entre
// Publicar → «Crear con IA» (proponerTitulosAction) y Optimización →
// «Mejorar título» (mejorarTituloIAAction): tendencias por nivel de la
// categoría + promptTitulos + llamada a la IA con cupo + leerPropuestaTitulos.
// Un solo prompt y una sola lógica: no se copia en cada módulo.
// Solo lee de Mercado Libre; no escribe nada.

import { llamarIA } from "@/lib/ia/proveedores";
import type { ConexionIAConClave } from "@/lib/ia/tipos";
import { tendenciasPorNivelMl } from "@/lib/ml/cliente";
import { ESPERA_TEXTO_MS } from "@/lib/publicaciones/analisis";
import { mensajeErrorIA } from "@/lib/publicaciones/errores";
import { limpiarInfoVendedor, type Ficha } from "@/lib/publicaciones/ficha";
import { conCupoDeTexto } from "@/lib/publicaciones/freno";
import { filtrarTendenciasRelacionadas, leerPropuestaTitulos, ORDEN_PARA_IA, promptTitulos, unirTendenciasPorNivel, type PalabraClave, type TendenciaConNivel } from "@/lib/publicaciones/titulos";

export type TitulosSeo = {
  ok: true;
  titulos: string[];
  catalogo: string | null;
  palabras: PalabraClave[];
  conTendencias: boolean;
  // «Más buscados en la categoría»: tendencias de la categoría general,
  // la padre y la específica, con su nivel, y la ruta analizada.
  masBuscados: TendenciaConNivel[];
  rutaCategoria: string[];
  // true = ML devolvió tendencias, pero ninguna se relaciona con el
  // producto (solo había de la categoría general o la padre).
  tendenciasSinRelacion: boolean;
};

function registrar(paso: string, error: unknown) {
  // Solo el nombre del error: nunca el mensaje del proveedor (podría traer datos).
  console.warn(`[lib/publicaciones/titulos-ia] ${paso}: ${error instanceof Error ? error.name : "error"}`);
}

export async function generarTitulosSeo(entrada: {
  empresaId: string;
  conexion: ConexionIAConClave;
  cuenta: { id: string; siteId: string };
  // El token se pide solo si hay categoría; si falla, se sigue sin tendencias.
  token: string | (() => Promise<string>);
  ficha: Ficha;
  categoriaId?: string | null;
  categoriaNombre?: string | null;
  info?: string;
  idioma: string;
  pais: string;
}): Promise<TitulosSeo | { ok: false; aviso: string }> {
  const { ficha } = entrada;
  let masBuscados: TendenciaConNivel[] = [];
  let rutaCategoria: string[] = [];
  let tendenciasSinRelacion = false;
  if (typeof entrada.categoriaId === "string" && entrada.categoriaId) {
    try {
      const token = typeof entrada.token === "function" ? await entrada.token() : entrada.token;
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
      registrar("tendencias", error);
    }
  }
  // Para la IA, primero las de la categoría específica (las más cercanas al producto).
  const tendencias = [...masBuscados].sort((a, b) => ORDEN_PARA_IA[a.nivel] - ORDEN_PARA_IA[b.nivel]).map((t) => t.palabra);
  const info = limpiarInfoVendedor(entrada.info);
  const categoria = typeof entrada.categoriaNombre === "string" ? entrada.categoriaNombre.slice(0, 120) : null;
  try {
    const respuesta = await conCupoDeTexto(entrada.empresaId, () =>
      llamarIA(entrada.conexion, promptTitulos({ ficha, idioma: entrada.idioma, pais: entrada.pais, categoria, tendencias, info }), { maxTokens: 800, timeoutMs: ESPERA_TEXTO_MS })
    );
    const propuesta = leerPropuestaTitulos(respuesta, { ficha, tendencias, info, niveles: masBuscados });
    if (!propuesta) return { ok: false, aviso: "La IA no devolvió títulos usables. Intenta de nuevo." };
    return { ok: true, ...propuesta, conTendencias: tendencias.length > 0, masBuscados, rutaCategoria, tendenciasSinRelacion };
  } catch (error) {
    registrar("titulos", error);
    return { ok: false, aviso: mensajeErrorIA(error) };
  }
}
