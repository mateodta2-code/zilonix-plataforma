// Optimización — recomendaciones del detalle de una publicación. Lógica
// pura: junta lo que Mercado Libre ya dice (boosts de competencia,
// objetivos de calidad, soluciones de experiencia de compra) y suma un
// aviso de stock bajo. No inventa nada: cada texto sale de ML, salvo los
// cuatro boosts conocidos, que se traducen a una frase corta.

import type { CalidadItemMl, CompetenciaItemMl, ExperienciaCompraMl } from "@/lib/ml/cliente";

// Decisión de Seller, NO de Mercado Libre: con 3 unidades o menos, la
// publicación se queda sin stock en pocos días y vale avisarlo.
export const STOCK_BAJO = 3;

export type OrigenRecomendacion = "competencia" | "calidad" | "experiencia" | "stock";
export type Recomendacion = { clave: string; texto: string; origen: OrigenRecomendacion };

const TEXTO_BOOST: Record<string, string> = {
  free_shipping: "Ofrece envío gratis",
  free_installments: "Ofrece cuotas sin interés",
  fulfillment: "Usa Mercado Envíos Full",
  same_day_shipping: "Ofrece envío en el día",
};

export function armarRecomendaciones(entrada: {
  competencia: CompetenciaItemMl | null;
  calidad: CalidadItemMl | null;
  experiencia: ExperienciaCompraMl | null;
  item: { stock: number | null; estado: string | null };
}): Recomendacion[] {
  const lista: Recomendacion[] = [];
  const vistos = new Set<string>();
  const agregar = (r: Recomendacion) => {
    const texto = r.texto.trim();
    if (!texto || vistos.has(texto.toLowerCase())) return;
    vistos.add(texto.toLowerCase());
    lista.push({ ...r, texto });
  };

  for (const b of entrada.competencia?.boosts ?? []) {
    if (b.estado !== "opportunity") continue;
    const texto = TEXTO_BOOST[b.id] ?? b.descripcion;
    if (texto) agregar({ clave: `competencia:${b.id}`, texto, origen: "competencia" });
  }
  for (const titulo of entrada.calidad?.pendientes ?? []) {
    agregar({ clave: `calidad:${titulo.toLowerCase()}`, texto: titulo, origen: "calidad" });
  }
  for (const p of entrada.experiencia?.problemas ?? []) {
    if (p.solucion) agregar({ clave: `experiencia:${p.etiqueta ?? p.solucion.toLowerCase()}`, texto: p.solucion, origen: "experiencia" });
  }
  const { stock, estado } = entrada.item;
  if (stock !== null && stock <= STOCK_BAJO && estado === "active") {
    agregar({ clave: "stock:bajo", texto: "Agrega más stock", origen: "stock" });
  }
  return lista;
}
